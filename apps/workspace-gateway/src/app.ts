import Fastify, { type FastifyInstance } from 'fastify';
import { clientOperationSchema } from '@cloudcrane/workspace-protocol';
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
): FastifyInstance {
  const app = Fastify({ bodyLimit: 16 * 1024 * 1024 });
  const dispatch = new WorkspaceDispatchService(store, registry);
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
        return reply.send({ result: await dispatch.execute(operation) });
      } catch (error) {
        if (error instanceof GatewayRemoteError)
          return reply.code(error.statusCode).send({ error: error.remote });
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_ARGUMENT', message: 'invalid workspace operation' } });
      }
    },
  );
  return app;
}
