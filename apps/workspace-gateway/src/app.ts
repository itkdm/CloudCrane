import Fastify, { type FastifyInstance } from 'fastify';
import { clientOperationSchema } from '@cloudcrane/workspace-protocol';
import {
  createLogger,
  enterLogContext,
  parseTraceparent,
  runWithTraceContext,
  serializeError,
  type ServiceLogger,
} from '@cloudcrane/shared';
import { performance } from 'node:perf_hooks';
import { GatewayRemoteError } from './errors.js';
import { WorkspaceDispatchService } from './application/dispatch-service.js';
import { attachRunnerTransport } from './transport.js';
import type { GatewayConfig } from './config.js';
import type { ControlPlaneStore } from './ports/control-plane-store.js';
import { RunnerRegistry } from './infrastructure/runner-registry.js';

export function buildGatewayApp(
  config: GatewayConfig,
  store: ControlPlaneStore,
  registry = new RunnerRegistry(),
  logger: ServiceLogger = createLogger('workspace-gateway.http'),
): FastifyInstance {
  const app = Fastify({ bodyLimit: 16 * 1024 * 1024 });
  const dispatch = new WorkspaceDispatchService(store, registry);
  const requestStarts = new WeakMap<object, number>();
  app.addHook('onRequest', async (request) => {
    requestStarts.set(request, performance.now());
    enterLogContext({
      requestId: request.id,
      ...parseTraceparent(
        typeof request.headers.traceparent === 'string' ? request.headers.traceparent : undefined,
      ),
    });
  });
  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        event: 'http.request.finished',
        operation: `${request.method} ${request.url.split('?')[0]}`,
        durationMs: Math.round(
          performance.now() - (requestStarts.get(request) ?? performance.now()),
        ),
        statusCode: reply.statusCode,
        outcome: reply.statusCode >= 500 ? 'failed' : 'succeeded',
      },
      'workspace gateway request completed',
    );
  });
  attachRunnerTransport(app, config, registry, store);
  app.get('/health', async () => ({ service: 'workspace-gateway', status: 'ok' }));
  app.post<{ Params: { workspaceId: string }; Body: unknown }>(
    '/v1/workspaces/:workspaceId/operations',
    async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${config.clientToken}`)
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'invalid client token' } });
      try {
        const operation = clientOperationSchema.parse(request.body);
        if (operation.workspaceId !== request.params.workspaceId)
          return reply.code(400).send({
            error: { code: 'INVALID_ARGUMENT', message: 'workspace id does not match route' },
          });
        logger.info(
          {
            event: 'workspace.operation.started',
            operation: operation.operation,
            workspaceId: operation.workspaceId,
            agentRunId: operation.agentRunId,
          },
          'workspace operation started',
        );
        const result = await runWithTraceContext(
          {
            traceparent:
              typeof request.headers.traceparent === 'string'
                ? request.headers.traceparent
                : undefined,
          },
          () => dispatch.execute(operation),
        );
        logger.info(
          {
            event: 'workspace.operation.finished',
            operation: operation.operation,
            workspaceId: operation.workspaceId,
            agentRunId: operation.agentRunId,
            outcome: 'succeeded',
          },
          'workspace operation completed',
        );
        return reply.send({ result });
      } catch (error) {
        if (error instanceof GatewayRemoteError)
          logger.warn(
            {
              event: 'workspace.operation.finished',
              outcome: 'failed',
              errorCode: error.remote.code,
              errorType: error.constructor.name,
            },
            'workspace operation failed',
          );
        if (error instanceof GatewayRemoteError)
          return reply.code(error.statusCode).send({ error: error.remote });
        logger.warn(
          { event: 'workspace.operation.finished', outcome: 'failed', ...serializeError(error) },
          'workspace operation rejected',
        );
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_ARGUMENT', message: 'invalid workspace operation' } });
      }
    },
  );
  return app;
}
