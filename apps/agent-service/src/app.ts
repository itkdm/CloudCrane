import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sessionSnapshotSchema, sessionViewSchema } from '@cloudcrane/agent-protocol';
import {
  assertWebsiteAccessForUser,
  AuthorizationError,
  headersFromNode,
  getUserRole,
  requireSession,
  type CloudCraneAuth,
} from '@cloudcrane/auth';
import {
  finishAuditEvent,
  insertAuditEvent,
  type AuditActorType,
  type PlatformDb,
} from '@cloudcrane/db';
import {
  createLogger,
  enterLogContext,
  getActiveTraceContext,
  getLogContext,
  parseTraceparent,
  serializeError,
  sanitizeRequestPath,
  type ServiceLogger,
} from '@cloudcrane/shared';
import { signPreviewToken } from '@cloudcrane/preview-access';
import type { AttachmentStorage } from '@cloudcrane/attachment-storage';
import { WebsiteAgentRuntimeError, type WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { AgentServiceError, asAgentServiceError } from './application/errors.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';
import type { AgentServiceConfig } from './config.js';
import { AgentSocketTransport } from './transport/agent-socket.js';
import { PreviewClientRegistry } from './infrastructure/preview-client-registry.js';
import {
  materializeReference,
  materializeTemplateReference,
  removeReference,
  ReferenceMaterializationError,
} from './infrastructure/reference-materializer.js';
import {
  ModelProfileService,
  type ModelProfileInput,
  type ModelProfileUpdateInput,
} from './infrastructure/model-profiles.js';
import { TEMPLATE_ARTIFACT_MAX_BYTES } from './infrastructure/template-limits.js';
import { ConversationAttachmentService } from './infrastructure/attachment-service.js';
import { listPublicModelPresets } from './infrastructure/model-catalog.js';

export type AgentServiceAppOptions = {
  config: AgentServiceConfig;
  registry: WebsiteRuntimeRegistry;
  auth?: CloudCraneAuth;
  db?: PlatformDb['db'];
  previewClientRegistry?: PreviewClientRegistry;
  logger?: ServiceLogger;
  attachmentStorage?: AttachmentStorage;
  modelProfiles?: ModelProfileService;
};

const auditLogger = createLogger('agent-service.audit');

export function buildAgentServiceApp(
  options: AgentServiceAppOptions,
): FastifyInstance & { agentSocket: AgentSocketTransport } {
  const app = Fastify({ bodyLimit: 256 * 1024 });
  const logger = options.logger ?? createLogger('agent-service.http');
  const attachmentService =
    options.db && options.attachmentStorage
      ? new ConversationAttachmentService(
          options.db,
          options.attachmentStorage,
          options.config.attachmentStorageDriver ?? 'local',
          options.config.attachmentMaxBytes ?? 20 * 1024 * 1024,
        )
      : undefined;
  const attachmentCleanupTimer = attachmentService
    ? setInterval(
        () => {
          void attachmentService.cleanupExpired().catch((error) => {
            logger.warn({ ...serializeError(error) }, 'attachment cleanup failed');
          });
        },
        60 * 60 * 1000,
      )
    : undefined;
  const requestStarts = new WeakMap<object, number>();
  void app.register(multipart, {
    limits: {
      files: 1,
      fileSize: Math.max(
        options.config.referenceUploadMaxBytes,
        options.config.attachmentMaxBytes ?? 20 * 1024 * 1024,
      ),
    },
  });
  const previewClients = options.previewClientRegistry ?? new PreviewClientRegistry();
  const sockets = new AgentSocketTransport({
    app,
    config: options.config,
    registry: options.registry,
    previewClients,
    auth: options.auth,
    db: options.db,
  });
  (app as unknown as FastifyInstance & { agentSocket: AgentSocketTransport }).agentSocket = sockets;
  app.addHook('onRequest', async (request, reply) => {
    requestStarts.set(request, performance.now());
    enterLogContext({
      requestId: request.id,
      ...parseTraceparent(
        typeof request.headers.traceparent === 'string' ? request.headers.traceparent : undefined,
      ),
    });
    if (request.method === 'OPTIONS') return;
    if (request.url === '/health') return;
    if (request.url.startsWith('/v1/internal/')) {
      if (
        !hasInternalToken(
          request.headers['x-cloudcrane-internal-token'],
          options.config.internalServiceToken,
        )
      )
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'internal authorization required' } });
      return;
    }
    const origin = request.headers.origin;
    if (origin && origin !== options.config.webOrigin)
      return reply
        .code(403)
        .send({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'origin is not allowed' } });
    if (!options.auth || !options.db) {
      if (process.env.NODE_ENV === 'production')
        return reply.code(503).send({
          error: { code: 'SERVICE_NOT_CONFIGURED', message: 'agent service is not configured' },
        });
      return;
    }
    try {
      const session = await requireSession(options.auth, headersFromNode(request.headers));
      enterLogContext({
        ...getLogContext(),
        userId: session.user.id,
        actorType: getUserRole(session) === 'admin' ? 'admin' : 'user',
      });
      const websiteId = (request.params as { websiteId?: string } | undefined)?.websiteId;
      if (websiteId)
        await assertWebsiteAccessForUser(
          options.db,
          session.user.id,
          getUserRole(session),
          websiteId,
        );
    } catch (error) {
      if (error instanceof AuthorizationError)
        return reply
          .code(error.status)
          .send({ error: { code: error.code, message: error.message } });
      throw error;
    }
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
      'agent service request completed',
    );
  });
  app.addHook('onSend', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin === options.config.webOrigin) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      reply.header('access-control-allow-headers', 'content-type');
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'Origin');
    }
  });
  app.options('/*', async (_request, reply) => reply.code(204).send());
  app.get('/health', async () => ({ service: 'agent-service', status: 'ok' }));
  app.get('/v1/model-profiles', async (request) => {
    if (!options.modelProfiles || !options.auth)
      throw new AgentServiceError('INTERNAL_ERROR', 'model profile service is unavailable', 503);
    const session = await requireSession(options.auth, headersFromNode(request.headers));
    return { profiles: await options.modelProfiles.list(session.user.id) };
  });
  app.get('/v1/model-catalog', async () => ({ presets: listPublicModelPresets() }));
  app.post<{ Body: Partial<ModelProfileInput> }>('/v1/model-profiles', async (request, reply) => {
    if (!options.modelProfiles || !options.auth)
      throw new AgentServiceError('INTERNAL_ERROR', 'model profile service is unavailable', 503);
    const session = await requireSession(options.auth, headersFromNode(request.headers));
    const body = request.body ?? {};
    if (
      (body.providerKind !== 'builtin' && body.providerKind !== 'openai-compatible') ||
      typeof body.providerId !== 'string' ||
      typeof body.modelId !== 'string' ||
      typeof body.apiKey !== 'string'
    )
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'provider, model and API key are required',
        400,
      );
    const profile = await options.modelProfiles.create(session.user.id, {
      providerKind: body.providerKind,
      presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
      providerId: body.providerId,
      modelId: body.modelId,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      api: typeof body.api === 'string' ? body.api : undefined,
      apiKey: body.apiKey,
      ...(Array.isArray(body.input) ? { input: body.input as ModelProfileInput['input'] } : {}),
      ...(typeof body.reasoning === 'boolean' ? { reasoning: body.reasoning } : {}),
      ...(typeof body.contextWindow === 'number' ? { contextWindow: body.contextWindow } : {}),
      ...(typeof body.maxTokens === 'number' ? { maxTokens: body.maxTokens } : {}),
      ...(typeof body.isDefault === 'boolean' ? { isDefault: body.isDefault } : {}),
    });
    return reply.code(201).send({ profile });
  });
  app.delete<{ Params: { profileId: string } }>(
    '/v1/model-profiles/:profileId',
    async (request, reply) => {
      if (!options.modelProfiles || !options.auth)
        throw new AgentServiceError('INTERNAL_ERROR', 'model profile service is unavailable', 503);
      const session = await requireSession(options.auth, headersFromNode(request.headers));
      await options.modelProfiles.delete(session.user.id, request.params.profileId);
      return reply.code(204).send();
    },
  );
  app.patch<{
    Params: { profileId: string };
    Body: Partial<ModelProfileUpdateInput>;
  }>('/v1/model-profiles/:profileId', async (request) => {
    if (!options.modelProfiles || !options.auth)
      throw new AgentServiceError('INTERNAL_ERROR', 'model profile service is unavailable', 503);
    const session = await requireSession(options.auth, headersFromNode(request.headers));
    const body = request.body ?? {};
    if (
      (body.providerKind !== 'builtin' && body.providerKind !== 'openai-compatible') ||
      typeof body.providerId !== 'string' ||
      typeof body.modelId !== 'string' ||
      (typeof body.baseUrl !== 'string' && typeof body.presetId !== 'string')
    )
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'provider, model and base URL are required',
        400,
      );
    const profile = await options.modelProfiles.update(session.user.id, request.params.profileId, {
      providerKind: body.providerKind,
      presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
      providerId: body.providerId,
      modelId: body.modelId,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      api: typeof body.api === 'string' ? body.api : undefined,
      apiKey: typeof body.apiKey === 'string' && body.apiKey ? body.apiKey : undefined,
      ...(Array.isArray(body.input) ? { input: body.input as ModelProfileUpdateInput['input'] } : {}),
      ...(typeof body.reasoning === 'boolean' ? { reasoning: body.reasoning } : {}),
      ...(typeof body.contextWindow === 'number' ? { contextWindow: body.contextWindow } : {}),
      ...(typeof body.maxTokens === 'number' ? { maxTokens: body.maxTokens } : {}),
    });
    return { profile };
  });
  app.post<{
    Params: { websiteId: string; sessionId: string };
  }>(
    '/v1/websites/:websiteId/sessions/:sessionId/attachments',
    { bodyLimit: (options.config.attachmentMaxBytes ?? 20 * 1024 * 1024) + 1024 * 1024 },
    async (request, reply) => {
      if (!attachmentService || !options.auth)
        throw new AgentServiceError('INTERNAL_ERROR', 'attachment storage is unavailable', 503);
      if (!isUuid(request.params.websiteId) || !isUuid(request.params.sessionId))
        throw new AgentServiceError('INVALID_ARGUMENT', 'invalid attachment parameters', 400);
      const session = await requireSession(options.auth, headersFromNode(request.headers));
      let result: Awaited<ReturnType<ConversationAttachmentService['upload']>> | undefined;
      for await (const part of request.parts()) {
        if (part.type !== 'file' || part.fieldname !== 'file' || result) {
          if (result) await attachmentService.remove(result.id, session.user.id);
          throw new AgentServiceError(
            'INVALID_ARGUMENT',
            'exactly one file field is required',
            400,
          );
        }
        result = await attachmentService.upload({
          userId: session.user.id,
          websiteId: request.params.websiteId,
          sessionId: request.params.sessionId,
          part,
        });
      }
      if (!result) throw new AgentServiceError('INVALID_ARGUMENT', 'file field is required', 400);
      return reply.code(201).send(result);
    },
  );
  app.post<{
    Params: { websiteId: string };
    Body: {
      workspaceId: string;
      templateId: string;
      artifactStorageKey: string;
      artifactSha256: string;
    };
  }>('/v1/internal/websites/:websiteId/template-attachment', async (request, reply) => {
    const { websiteId } = request.params;
    if (
      !isUuid(websiteId) ||
      !isUuid(request.body?.workspaceId) ||
      !isUuid(request.body?.templateId)
    )
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'invalid template attachment parameters',
        400,
      );
    const binding = await options.registry.resolveBinding(websiteId);
    if (binding.workspaceId !== request.body.workspaceId)
      throw new AgentServiceError('WEBSITE_FORBIDDEN', 'website and workspace do not match', 403);
    const result = await materializeTemplateReference({
      artifactRoot: options.config.templateArtifactRoot ?? '.cloudcrane-data/templates',
      artifactStorageKey: request.body.artifactStorageKey,
      artifactSha256: request.body.artifactSha256,
      templateId: request.body.templateId,
      referenceRoot: options.config.referenceRoot,
      workspaceId: binding.workspaceId,
      maxBytes: options.config.templateArtifactMaxBytes ?? TEMPLATE_ARTIFACT_MAX_BYTES,
    });
    return reply.code(201).send(result);
  });
  app.delete<{ Params: { websiteId: string } }>(
    '/v1/internal/websites/:websiteId/runtime',
    async (request, reply) => {
      if (!isUuid(request.params.websiteId))
        throw new AgentServiceError('INVALID_ARGUMENT', 'websiteId must be a UUID', 400);
      sockets.disposeWebsite(request.params.websiteId);
      previewClients.disposeWebsite(request.params.websiteId);
      await options.registry.dispose(request.params.websiteId);
      await rm(path.join(options.config.agentDataRoot, request.params.websiteId), {
        recursive: true,
        force: true,
      });
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { websiteId: string } }>(
    '/v1/internal/websites/:websiteId/runtime/finalize',
    async (request, reply) => {
      if (!isUuid(request.params.websiteId))
        throw new AgentServiceError('INVALID_ARGUMENT', 'websiteId must be a UUID', 400);
      options.registry.forget(request.params.websiteId);
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { websiteId: string; sessionId: string; interactionId: string } }>(
    '/v1/websites/:websiteId/sessions/:sessionId/interactions/:interactionId/reference-upload',
    { bodyLimit: options.config.referenceUploadMaxBytes + 1024 * 1024 },
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
      await mkdir(path.dirname(staging), { recursive: true });
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
            archiveMaxBytes: options.config.referenceUploadMaxBytes,
          });
          try {
            runtime.resolveReferenceUpload(
              request.params.interactionId,
              request.params.sessionId,
              result,
            );
          } catch (error) {
            await removeReference({
              referenceRoot: options.config.referenceRoot,
              workspaceId: runtime.workspaceId,
              referenceId: result.referenceId,
            });
            throw error;
          }
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
    const origin = options.config.previewGatewayOriginTemplate
      .replace('{previewSlug}', binding.previewSlug ?? binding.websiteId)
      .replace('{websiteId}', binding.websiteId);
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
      const auditId = await startSessionAudit(
        options.db,
        'agent.session.create',
        request.params.websiteId,
      );
      try {
        const created = await runtime.createSession();
        await finishSessionAudit(options.db, auditId, 'SUCCESS', {
          websiteSessionId: created.id,
        });
        return { session: toSessionView(created) };
      } catch (error) {
        await finishSessionAudit(options.db, auditId, 'FAILED', { error });
        throw error;
      }
    },
  );
  app.patch<{
    Params: { websiteId: string; sessionId: string };
    Body: { title?: unknown; pinned?: unknown };
  }>('/v1/websites/:websiteId/sessions/:sessionId', async (request) => {
    const runtime = await getRuntime(options.registry, request.params.websiteId);
    const body = request.body ?? {};
    if (
      (body.title !== undefined && typeof body.title !== 'string') ||
      (body.pinned !== undefined && typeof body.pinned !== 'boolean') ||
      (body.title !== undefined && body.pinned !== undefined) ||
      (body.title === undefined && body.pinned === undefined)
    )
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'exactly one of title or pinned is required',
        400,
      );
    const operation = body.title !== undefined ? 'agent.session.rename' : 'agent.session.pin';
    const auditId = await startSessionAudit(
      options.db,
      operation,
      request.params.websiteId,
      request.params.sessionId,
    );
    try {
      const session =
        body.title !== undefined
          ? await runtime.renameSession(request.params.sessionId, body.title)
          : await runtime.setSessionPinned(request.params.sessionId, body.pinned as boolean);
      await finishSessionAudit(options.db, auditId, 'SUCCESS', {
        websiteSessionId: session.id,
      });
      return { session: toSessionView(session) };
    } catch (error) {
      await finishSessionAudit(options.db, auditId, 'FAILED', { error });
      throw error;
    }
  });
  app.post<{ Params: { websiteId: string; sessionId: string } }>(
    '/v1/websites/:websiteId/sessions/:sessionId/clone',
    async (request) => {
      const runtime = await getRuntime(options.registry, request.params.websiteId);
      const auditId = await startSessionAudit(
        options.db,
        'agent.session.clone',
        request.params.websiteId,
        request.params.sessionId,
      );
      try {
        const cloned = await runtime.cloneSession(request.params.sessionId);
        await finishSessionAudit(options.db, auditId, 'SUCCESS', {
          websiteSessionId: cloned.id,
        });
        return { session: toSessionView(cloned) };
      } catch (error) {
        await finishSessionAudit(options.db, auditId, 'FAILED', { error });
        throw error;
      }
    },
  );
  app.delete<{ Params: { websiteId: string; sessionId: string } }>(
    '/v1/websites/:websiteId/sessions/:sessionId',
    async (request, reply) => {
      const runtime = await getRuntime(options.registry, request.params.websiteId);
      const auditId = await startSessionAudit(
        options.db,
        'agent.session.delete',
        request.params.websiteId,
        request.params.sessionId,
      );
      try {
        await runtime.deleteSession(request.params.sessionId);
        await finishSessionAudit(options.db, auditId, 'SUCCESS', {
          deletedSessionId: request.params.sessionId,
        });
      } catch (error) {
        await finishSessionAudit(options.db, auditId, 'FAILED', { error });
        throw error;
      }
      return reply.code(204).send();
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
        contextUsage: snapshot.contextUsage,
        contextMaintenance: snapshot.contextMaintenance,
        activeRun: snapshot.activeRun,
        pendingInteractions: snapshot.pendingInteractions,
      });
    },
  );
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ReferenceMaterializationError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: 'INVALID_REFERENCE', message: error.message } });
    const mapped = asAgentServiceError(error);
    const params = request.params as {
      websiteId?: string;
      sessionId?: string;
      interactionId?: string;
    };
    logger.error(
      {
        ...serializeError(error),
        requestId: request.id,
        method: request.method,
        url: sanitizeRequestPath(request.url),
        websiteId: params.websiteId,
        sessionId: params.sessionId,
        interactionId: params.interactionId,
        errorCode: mapped.code,
        statusCode: mapped.statusCode,
      },
      'agent service request failed',
    );
    return reply
      .code(mapped.statusCode)
      .send({ error: { code: mapped.code, message: mapped.message } });
  });
  app.addHook('onClose', async () => {
    if (attachmentCleanupTimer) clearInterval(attachmentCleanupTimer);
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
  } catch (error) {
    if (error instanceof AgentServiceError) throw error;
    if (error instanceof WebsiteAgentRuntimeError && error.code === 'SESSION_NOT_FOUND')
      throw new AgentServiceError('SESSION_NOT_FOUND', 'website session was not found', 404);
    throw error;
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
  pinnedAt: string | null;
  clonedFromSessionId: string | null;
}) {
  return sessionViewSchema.parse({
    id: session.id,
    title: session.title,
    status: session.status,
    piSessionId: session.piSessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActiveAt: session.lastActiveAt,
    pinnedAt: session.pinnedAt,
    clonedFromSessionId: session.clonedFromSessionId,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasInternalToken(value: string | string[] | undefined, expected?: string): boolean {
  if (!expected) return false;
  const actual = Array.isArray(value) ? value[0] : value;
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

type SessionAudit = { id: string; startedAt: number };

async function startSessionAudit(
  db: PlatformDb['db'] | undefined,
  operation: string,
  websiteId: string,
  sessionId?: string,
): Promise<SessionAudit | undefined> {
  if (!db) return undefined;
  const context = getLogContext();
  const traceContext = getActiveTraceContext();
  const actorType: AuditActorType = context.actorType === 'admin' ? 'admin' : 'user';
  try {
    const id = await insertAuditEvent(db, {
      actorType,
      actorUserId: context.userId,
      websiteId,
      websiteSessionId: sessionId,
      traceId: traceContext.traceId ?? context.traceId,
      spanId: traceContext.spanId ?? context.spanId,
      runCorrelationId: context.runCorrelationId,
      requestId: context.requestId,
      operation,
      resourceType: 'website_session',
      resourceRef: sessionId,
      status: 'PENDING',
      requestSummary: sessionId ? { sessionId } : undefined,
    });
    return { id, startedAt: Date.now() };
  } catch (error) {
    auditLogger.error(
      { event: 'audit.write.failed', operation, websiteId, ...serializeError(error) },
      'session mutation audit could not be created',
    );
    throw new AgentServiceError('AUDIT_UNAVAILABLE', 'session mutation audit is unavailable', 503);
  }
}

async function finishSessionAudit(
  db: PlatformDb['db'] | undefined,
  audit: SessionAudit | undefined,
  status: 'SUCCESS' | 'FAILED',
  result: { websiteSessionId?: string; deletedSessionId?: string; error?: unknown },
): Promise<boolean> {
  if (!db || !audit) return true;
  const errorDetails = result.error === undefined ? undefined : serializeError(result.error);
  try {
    await finishAuditEvent(db, audit.id, {
      status,
      durationMs: Date.now() - audit.startedAt,
      errorCode: errorDetails?.errorCode,
      errorType: errorDetails?.errorType,
      resultSummary: {
        ...(result.websiteSessionId ? { websiteSessionId: result.websiteSessionId } : {}),
        ...(result.deletedSessionId ? { deletedSessionId: result.deletedSessionId } : {}),
      },
    });
  } catch (error) {
    auditLogger.error(
      {
        event: 'audit.write.failed',
        auditEventId: audit.id,
        outcome: 'unknown',
        ...serializeError(error),
      },
      'session mutation audit could not be finalized',
    );
    return false;
  }
  return true;
}
