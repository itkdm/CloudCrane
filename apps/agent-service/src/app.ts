import Fastify, { type FastifyInstance } from 'fastify';
import { sessionSnapshotSchema, sessionViewSchema } from '@cloudcrane/agent-protocol';
import { signPreviewToken } from '@cloudcrane/preview-access';
import type { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { AgentServiceError, asAgentServiceError } from './application/errors.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';
import type { AgentServiceConfig } from './config.js';
import { AgentSocketTransport } from './transport/agent-socket.js';
import { PreviewClientRegistry } from './infrastructure/preview-client-registry.js';

export type AgentServiceAppOptions = {
  config: AgentServiceConfig;
  registry: WebsiteRuntimeRegistry;
  previewClientRegistry?: PreviewClientRegistry;
};

export function buildAgentServiceApp(
  options: AgentServiceAppOptions,
): FastifyInstance & { agentSocket: AgentSocketTransport } {
  const app = Fastify({ bodyLimit: 256 * 1024 });
  const previewClients = options.previewClientRegistry ?? new PreviewClientRegistry();
  const sockets = new AgentSocketTransport({
    app,
    config: options.config,
    registry: options.registry,
    previewClients,
  });
  (app as unknown as FastifyInstance & { agentSocket: AgentSocketTransport }).agentSocket = sockets;
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const origin = request.headers.origin;
    if (origin && origin !== options.config.webOrigin)
      return reply
        .code(403)
        .send({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'origin is not allowed' } });
  });
  app.addHook('onSend', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin === options.config.webOrigin) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
      reply.header('access-control-allow-headers', 'content-type');
      reply.header('vary', 'Origin');
    }
  });
  app.options('/*', async (_request, reply) => reply.code(204).send());
  app.get('/health', async () => ({ service: 'agent-service', status: 'ok' }));
  app.get<{ Params: { websiteId: string } }>('/v1/websites/:websiteId/preview', async (request) => {
    if (!isUuid(request.params.websiteId))
      throw new AgentServiceError('INVALID_ARGUMENT', 'websiteId must be a UUID', 400);
    const binding = await options.registry.resolve(request.params.websiteId);
    if (!binding.previewPort)
      throw new AgentServiceError('WORKSPACE_NOT_READY', 'website preview is not ready', 409);
    const token = signPreviewToken(
      {
        websiteId: binding.websiteId,
        expiresAt: Math.floor(Date.now() / 1000) + options.config.previewTokenTtlSeconds,
      },
      options.config.previewSigningSecret,
    );
    const origin = options.config.previewGatewayOriginTemplate.replace(
      '{websiteId}',
      binding.websiteId,
    );
    return { url: `${origin.replace(/\/$/, '')}/?token=${encodeURIComponent(token)}` };
  });
  app.get<{ Params: { websiteId: string } }>(
    '/v1/websites/:websiteId/sessions',
    async (request) => {
      const runtime = await getRuntime(options.registry, request.params.websiteId);
      return { sessions: (await runtime.listSessions()).map(toSessionView) };
    },
  );
  app.post<{ Params: { websiteId: string } }>(
    '/v1/websites/:websiteId/sessions',
    async (request) => {
      const runtime = await getRuntime(options.registry, request.params.websiteId);
      return { session: toSessionView(await runtime.createSession()) };
    },
  );
  app.get<{ Params: { websiteId: string; sessionId: string } }>(
    '/v1/websites/:websiteId/sessions/:sessionId/snapshot',
    async (request) => {
      const runtime = await getRuntime(options.registry, request.params.websiteId);
      const snapshot = await getSnapshot(runtime, request.params.sessionId);
      return sessionSnapshotSchema.parse({
        session: toSessionView(snapshot.session),
        messages: snapshot.messages,
        contextMaintenance: snapshot.contextMaintenance,
        activeRun: snapshot.activeRun,
      });
    },
  );
  app.setErrorHandler((error, _request, reply) => {
    const mapped = asAgentServiceError(error);
    return reply
      .code(mapped.statusCode)
      .send({ error: { code: mapped.code, message: mapped.message } });
  });
  app.addHook('onClose', async () => {
    await sockets.close();
    previewClients.close();
    await options.registry.shutdown();
  });
  return app as unknown as FastifyInstance & { agentSocket: AgentSocketTransport };
}

async function getRuntime(
  registry: WebsiteRuntimeRegistry,
  websiteId: string,
): Promise<WebsiteAgentRuntime> {
  if (!isUuid(websiteId))
    throw new AgentServiceError('INVALID_ARGUMENT', 'websiteId must be a UUID', 400);
  return registry.get(websiteId);
}

async function getSnapshot(runtime: WebsiteAgentRuntime, sessionId: string) {
  if (!isUuid(sessionId))
    throw new AgentServiceError('INVALID_ARGUMENT', 'sessionId must be a UUID', 400);
  try {
    return await runtime.getSessionSnapshot(sessionId);
  } catch {
    throw new AgentServiceError('SESSION_NOT_FOUND', 'website session was not found', 404);
  }
}

function toSessionView(session: {
  id: string;
  title: string | null;
  status: string;
  piSessionId: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
}) {
  return sessionViewSchema.parse({
    id: session.id,
    title: session.title,
    status: session.status,
    piSessionId: session.piSessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActiveAt: session.lastActiveAt,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
