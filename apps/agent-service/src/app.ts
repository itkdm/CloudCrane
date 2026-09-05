import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sessionSnapshotSchema, sessionViewSchema } from '@cloudcrane/agent-protocol';
import { signPreviewToken } from '@cloudcrane/preview-access';
import type { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { AgentServiceError, asAgentServiceError } from './application/errors.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';
import type { AgentServiceConfig } from './config.js';
import { AgentSocketTransport } from './transport/agent-socket.js';
import { PreviewClientRegistry } from './infrastructure/preview-client-registry.js';
import {
  materializeReference,
  ReferenceMaterializationError,
} from './infrastructure/reference-materializer.js';

export type AgentServiceAppOptions = {
  config: AgentServiceConfig;
  registry: WebsiteRuntimeRegistry;
  previewClientRegistry?: PreviewClientRegistry;
};

export function buildAgentServiceApp(
  options: AgentServiceAppOptions,
): FastifyInstance & { agentSocket: AgentSocketTransport } {
  const app = Fastify({ bodyLimit: 256 * 1024 });
  void app.register(multipart, {
    limits: { files: 1, fileSize: options.config.referenceUploadMaxBytes },
  });
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
  app.post<{ Params: { websiteId: string; sessionId: string; interactionId: string } }>(
    '/v1/websites/:websiteId/sessions/:sessionId/interactions/:interactionId/reference-upload',
    async (request, reply) => {
      const runtime = await getRuntime(options.registry, request.params.websiteId);
      if (!isUuid(request.params.sessionId) || !isUuid(request.params.interactionId))
        throw new AgentServiceError('INVALID_ARGUMENT', 'invalid interaction parameters', 400);
      if (!runtime.isReferenceUploadPending(request.params.interactionId, request.params.sessionId))
        throw new AgentServiceError(
          'INTERACTION_NOT_FOUND',
          'reference upload is not pending',
          409,
        );
      const staging = `${options.config.referenceRoot}/.staging/upload-${randomUUID()}.zip`;
      await mkdir(options.config.referenceRoot, { recursive: true });
      let fileSeen = false;
      let size = 0;
      const hash = createHash('sha256');
      try {
        for await (const part of request.parts()) {
          if (part.type !== 'file' || part.fieldname !== 'file' || fileSeen)
            throw new AgentServiceError(
              'INVALID_ARGUMENT',
              'exactly one file field is required',
              400,
            );
          fileSeen = true;
          const counted = new Transform({
            transform(chunk, _encoding, callback) {
              size += chunk.length;
              hash.update(chunk);
              if (size > options.config.referenceUploadMaxBytes)
                callback(
                  new AgentServiceError('INVALID_ARGUMENT', 'reference upload is too large', 413),
                );
              else callback(null, chunk);
            },
          });
          await pipeline(part.file, counted, createWriteStream(staging));
          if (part.file.truncated)
            throw new AgentServiceError('INVALID_ARGUMENT', 'reference upload is too large', 413);
          const result = await materializeReference({
            archivePath: staging,
            referenceRoot: options.config.referenceRoot,
            workspaceId: runtime.workspaceId,
            originalFilename: part.filename,
            sha256: hash.digest('hex'),
            size,
          });
          runtime.resolveReferenceUpload(
            request.params.interactionId,
            request.params.sessionId,
            result,
          );
          return reply.code(201).send(result);
        }
        throw new AgentServiceError('INVALID_ARGUMENT', 'file field is required', 400);
      } finally {
        await rm(staging, { force: true }).catch(() => undefined);
      }
    },
  );
  app.get<{ Params: { websiteId: string } }>('/v1/websites/:websiteId/preview', async (request) => {
    if (!isUuid(request.params.websiteId))
      throw new AgentServiceError('INVALID_ARGUMENT', 'websiteId must be a UUID', 400);
    const binding = await options.registry.resolve(request.params.websiteId);
    if (!binding.previewPort)
      throw new AgentServiceError('WORKSPACE_NOT_READY', 'website preview is not ready', 409);
    const expiresAt = Math.floor(Date.now() / 1000) + options.config.previewTokenTtlSeconds;
    const token = signPreviewToken(
      {
        websiteId: binding.websiteId,
        expiresAt,
      },
      options.config.previewSigningSecret,
    );
    const origin = options.config.previewGatewayOriginTemplate.replace(
      '{websiteId}',
      binding.websiteId,
    );
    return { url: `${origin.replace(/\/$/, '')}/?token=${encodeURIComponent(token)}`, expiresAt };
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
        pendingInteractions: snapshot.pendingInteractions,
      });
    },
  );
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ReferenceMaterializationError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: 'INVALID_REFERENCE', message: error.message } });
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
