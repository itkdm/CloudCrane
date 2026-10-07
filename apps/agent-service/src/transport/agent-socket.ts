import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  agentCommandSchema,
  createAgentEnvelope,
  type AgentCommand,
  type AgentWireMessage,
  type SnapshotMessage,
} from '@cloudcrane/agent-protocol';
import type { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { AgentServiceError, asAgentServiceError } from '../application/errors.js';
import { WebsiteRuntimeRegistry } from '../application/runtime-registry.js';
import type { AgentServiceConfig } from '../config.js';
import { PreviewClientRegistry } from '../infrastructure/preview-client-registry.js';
import { projectWebsiteAgentEvent } from './agent-event-projector.js';
import {
  createLogger,
  createRequestId,
  parseTraceparent,
  runWithLogContext,
  runWithTraceContext,
  serializeError,
  withSpan,
  type LogContext,
} from '@cloudcrane/shared';
import {
  assertWebsiteAccessForUser,
  AuthorizationError,
  getUserRole,
  headersFromNode,
  type CloudCraneAuth,
} from '@cloudcrane/auth';
import type { PlatformDb } from '@cloudcrane/db';

function isEventReflectedByHistory(message: AgentWireMessage, history: SnapshotMessage[]): boolean {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as Record<string, unknown>;
  if (
    message.type === 'assistant.started' ||
    message.type === 'assistant.delta' ||
    message.type === 'assistant.completed'
  ) {
    return (
      typeof value.messageId === 'string' && history.some((item) => item.id === value.messageId)
    );
  }
  if (message.type === 'user.added') {
    const userMessage = value.message;
    return (
      !!userMessage &&
      typeof userMessage === 'object' &&
      'id' in userMessage &&
      typeof userMessage.id === 'string' &&
      history.some((item) => item.id === userMessage.id)
    );
  }
  if (
    message.type === 'tool.started' ||
    message.type === 'tool.updated' ||
    message.type === 'tool.completed'
  ) {
    return (
      typeof value.toolCallId === 'string' &&
      history.some((item) => item.toolCallId === value.toolCallId)
    );
  }
  return false;
}

const logger = createLogger('agent-service.socket');

type AgentSocketOptions = {
  app: FastifyInstance;
  config: AgentServiceConfig;
  registry: WebsiteRuntimeRegistry;
  previewClients: PreviewClientRegistry;
  auth?: CloudCraneAuth;
  db?: PlatformDb['db'];
};

export class AgentSocketTransport {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  private readonly connections = new Set<AgentSocketConnection>();

  constructor(private readonly options: AgentSocketOptions) {
    options.app.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/v1/agent/connect') return;
      const origin = request.headers.origin;
      if (origin !== options.config.webOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      void this.authorizeAndUpgrade(request, socket, head);
    });
  }

  private async authorizeAndUpgrade(
    request: import('node:http').IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) {
    if (!this.options.auth || !this.options.db) {
      if (process.env.NODE_ENV === 'production') {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.server.handleUpgrade(request, socket, head, (ws) => {
        const connection = new AgentSocketConnection(
          ws,
          this.options,
          undefined,
          undefined,
          socketContext(request),
          () => this.connections.delete(connection),
        );
        this.connections.add(connection);
      });
      return;
    }
    const sessionHeaders = headersFromNode(request.headers);
    const session = await this.options.auth.api.getSession({ headers: sessionHeaders });
    if (!session || (session.user as { banned?: boolean }).banned) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.server.handleUpgrade(request, socket, head, (ws) => {
      const connection = new AgentSocketConnection(
        ws,
        this.options,
        session.user.id,
        sessionHeaders,
        { ...socketContext(request), userId: session.user.id },
        () => this.connections.delete(connection),
      );
      this.connections.add(connection);
    });
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  disposeWebsite(websiteId: string): void {
    for (const connection of this.connections) {
      if (connection.belongsToWebsite(websiteId)) connection.close(1000, 'website deleted');
    }
  }

  async close(): Promise<void> {
    for (const connection of this.connections) connection.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

class AgentSocketConnection {
  private readonly connectionId = randomUUID();
  private runtime?: WebsiteAgentRuntime;
  private runtimeReady = false;
  private sessionId?: string;
  private unsubscribe?: () => void;
  private websiteId?: string;
  private closed = false;
  private previewWebsiteId?: string;
  private previewClientId?: string;
  private attachState?: {
    sessionId: string;
    queued: ReturnType<typeof createAgentEnvelope>[];
  };
  private readonly previewConnection = {
    send: (message: ReturnType<typeof createAgentEnvelope>) => this.write(message),
  };

  constructor(
    private readonly socket: WebSocket,
    private readonly options: AgentSocketOptions,
    private readonly userId: string | undefined,
    private readonly sessionHeaders: Headers | undefined,
    private readonly logContext: LogContext,
    private readonly onClose: () => void,
  ) {
    socket.on('message', (raw) => void this.handleMessage(raw.toString()));
    socket.on('close', (code, reason) => this.dispose(code, reason.toString()));
    socket.on('error', (error) => {
      logger.warn(
        { connectionId: this.connectionId, ...serializeError(error) },
        'agent websocket error',
      );
      this.dispose(undefined, error.message);
    });
    logger.info({ connectionId: this.connectionId }, 'agent websocket connected');
    this.send('connection.ready', { connectionId: this.connectionId });
  }

  close(code = 1000, reason?: string): void {
    this.socket.close(code, reason);
    this.dispose();
  }

  belongsToWebsite(websiteId: string): boolean {
    return this.websiteId === websiteId || this.previewWebsiteId === websiteId;
  }

  private async handleMessage(raw: string): Promise<void> {
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      this.sendError(
        'unknown',
        new AgentServiceError('INVALID_ARGUMENT', 'message must be valid JSON', 400),
      );
      return;
    }
    const parsed = agentCommandSchema.safeParse(input);
    if (!parsed.success) {
      this.sendError(
        'unknown',
        new AgentServiceError('INVALID_ARGUMENT', 'invalid agent command', 400),
      );
      return;
    }
    const command = parsed.data;
    return runWithLogContext(
      {
        ...this.logContext,
        connectionId: this.connectionId,
        requestId: command.requestId,
        websiteId: command.websiteId,
        sessionId: command.sessionId,
        operation: command.type,
      },
      async () => {
        logger.info(
          {
            event: 'agent.command.received',
            connectionId: this.connectionId,
            commandType: command.type,
          },
          'agent command received',
        );
        try {
          const currentSession = await this.getCurrentSession();
          if (this.options.auth && this.options.db && this.sessionHeaders && !currentSession)
            return;
          if (this.options.db && currentSession)
            await assertWebsiteAccessForUser(
              this.options.db,
              currentSession.user.id,
              getUserRole(currentSession),
              command.websiteId,
            );
          await runWithTraceContext({ traceparent: command.traceparent }, () =>
            withSpan(
              'agent.command',
              {
                'cloudcrane.command_type': command.type,
                'cloudcrane.request_id': command.requestId,
                'cloudcrane.website_id': command.websiteId,
                'cloudcrane.session_id': command.sessionId,
              },
              () => this.dispatch(command),
            ),
          );
          logger.info(
            {
              event: 'agent.command.completed',
              connectionId: this.connectionId,
              commandType: command.type,
              outcome: 'succeeded',
            },
            'agent command dispatched',
          );
        } catch (error) {
          const serviceError =
            error instanceof AuthorizationError &&
            (error.code === 'WEBSITE_FORBIDDEN' || error.code === 'WEBSITE_NOT_FOUND')
              ? new AgentServiceError(error.code, error.message, error.status)
              : asAgentServiceError(error);
          logger.warn(
            {
              event: 'agent.command.failed',
              connectionId: this.connectionId,
              commandType: command.type,
              errorCode: serviceError.code,
              outcome: 'failed',
            },
            'agent command dispatch failed',
          );
          this.sendError(command.requestId, serviceError, command);
        }
      },
    );
  }

  private async getCurrentSession() {
    if (!this.options.auth || !this.options.db || !this.sessionHeaders) return undefined;
    const session = await this.options.auth.api.getSession({ headers: this.sessionHeaders });
    if (
      !session ||
      session.user.id !== this.userId ||
      (session.user as { banned?: boolean }).banned
    ) {
      this.close(1008, 'authentication required');
      return undefined;
    }
    return session;
  }

  private async dispatch(command: AgentCommand): Promise<void> {
    if (command.type === 'session.attach') {
      if (this.previewWebsiteId && this.previewWebsiteId !== command.websiteId)
        throw new AgentServiceError(
          'INVALID_ARGUMENT',
          'Preview Client website does not match session',
          400,
        );
      const runtime = await this.options.registry.get(command.websiteId);
      this.unsubscribe?.();
      this.attachState = undefined;
      this.runtime = runtime;
      this.websiteId = command.websiteId;
      this.sessionId = command.payload.sessionId;
      this.runtimeReady = false;
      const attachState = {
        sessionId: command.payload.sessionId,
        queued: [] as ReturnType<typeof createAgentEnvelope>[],
      };
      this.attachState = attachState;
      this.unsubscribe = runtime.subscribe((event) => {
        if (event.websiteSessionId !== this.sessionId) return;
        const message = projectWebsiteAgentEvent(event);
        if (!message) return;
        if (this.attachState === attachState) attachState.queued.push(message);
        else this.write(message);
      });
      this.ack(command);
      const historyStartedAt = performance.now();
      let historySent = false;
      try {
        const history = await runtime.getSessionHistoryPage(command.payload.sessionId);
        if (this.attachState !== attachState) return;
        // Preserve concurrent runtime events, skipping only message updates already
        // represented by the history projection to avoid replaying duplicate deltas.
        attachState.queued = attachState.queued.filter(
          (message) => !isEventReflectedByHistory(message, history.messages),
        );
        const session = toSessionView(history.session);
        this.send('session.attached', { session });
        this.send('session.history.snapshot', {
          session,
          messages: history.messages,
          olderCursor: history.olderCursor,
          hasMore: history.hasMore,
        });
        historySent = true;
        logger.info(
          {
            event: 'agent.session.history.ready',
            connectionId: this.connectionId,
            websiteId: command.websiteId,
            sessionId: command.payload.sessionId,
            durationMs: Math.round(performance.now() - historyStartedAt),
            messageCount: history.messages.length,
            hasMore: history.hasMore,
          },
          'agent session history ready',
        );

        const runtimeStartedAt = performance.now();
        try {
          await runtime.openSession(command.payload.sessionId);
          const runtimeState = await runtime.getSessionRuntimeState(command.payload.sessionId);
          if (this.attachState !== attachState) return;
          this.runtimeReady = true;
          this.send('session.runtime.ready', {
            session: toSessionView(runtimeState.session),
            contextUsage: runtimeState.contextUsage,
            contextMaintenance: runtimeState.contextMaintenance,
            activeRun: runtimeState.activeRun,
            pendingInteractions: runtimeState.pendingInteractions,
          });
          logger.info(
            {
              event: 'agent.session.runtime.ready',
              connectionId: this.connectionId,
              websiteId: command.websiteId,
              sessionId: command.payload.sessionId,
              durationMs: Math.round(performance.now() - runtimeStartedAt),
            },
            'agent session runtime ready',
          );
        } catch (error) {
          if (this.attachState !== attachState) return;
          this.runtimeReady = false;
          logger.warn(
            {
              event: 'agent.session.runtime.failed',
              connectionId: this.connectionId,
              websiteId: command.websiteId,
              sessionId: command.payload.sessionId,
              durationMs: Math.round(performance.now() - runtimeStartedAt),
              ...serializeError(error),
            },
            'agent session runtime failed after history loaded',
          );
          this.send('session.runtime.failed', {
            code: 'SESSION_RUNTIME_UNAVAILABLE',
            message: 'Agent runtime is unavailable',
          });
        }
      } catch (error) {
        if (!historySent) {
          this.unsubscribe?.();
          this.unsubscribe = undefined;
          this.runtime = undefined;
          this.sessionId = undefined;
          this.websiteId = undefined;
          this.attachState = undefined;
          this.runtimeReady = false;
          if ((error as { code?: unknown })?.code === 'SESSION_NOT_FOUND')
            throw new AgentServiceError('SESSION_NOT_FOUND', 'website session was not found', 404);
          throw error;
        }
      } finally {
        if (this.attachState === attachState) {
          this.attachState = undefined;
          attachState.queued.forEach((message) => this.write(message));
        }
      }
      return;
    }
    if (command.type === 'session.history.load') {
      this.requireAttached(command);
      const page = await this.runtime!.getSessionHistoryPage(
        this.sessionId!,
        command.payload.cursor,
      );
      this.send(
        'session.history.page',
        {
          session: toSessionView(page.session),
          messages: page.messages,
          olderCursor: page.olderCursor,
          hasMore: page.hasMore,
        },
        command.requestId,
      );
      this.ack(command);
      return;
    }
    if (command.type === 'preview.client.register') {
      const isSameClient =
        this.previewWebsiteId === command.websiteId &&
        this.previewClientId === command.payload.previewClientId;
      if (!isSameClient && this.previewWebsiteId && this.previewClientId)
        this.options.previewClients.unregister(
          this.previewWebsiteId,
          this.previewClientId,
          this.previewConnection,
        );
      this.previewWebsiteId = command.websiteId;
      this.previewClientId = command.payload.previewClientId;
      this.options.previewClients.register(
        command.websiteId,
        command.payload.previewClientId,
        command.payload.capabilities,
        this.previewConnection,
      );
      this.ack(command);
      return;
    }
    if (command.type === 'preview.client.capabilities') {
      if (
        this.previewWebsiteId !== command.websiteId ||
        this.previewClientId !== command.payload.previewClientId ||
        !this.options.previewClients.updateCapabilities(
          command.websiteId,
          command.payload.previewClientId,
          command.payload.capabilities,
          this.previewConnection,
        )
      )
        throw new AgentServiceError('INVALID_ARGUMENT', 'Preview Client is not registered', 400);
      this.ack(command);
      return;
    }
    if (command.type === 'preview.response') {
      // Preview responses are asynchronous. The browser can legitimately send
      // one after the server-side request timed out or the socket was replaced.
      // Such a response has no command caller to notify and must not become a
      // misleading user-visible command error (especially "unsupported path").
      if (this.previewWebsiteId && this.previewClientId)
        this.options.previewClients.respond(
          command.websiteId,
          this.previewClientId,
          command.requestId,
          command.payload,
          this.previewConnection,
        );
      return;
    }
    this.requireAttached(command);
    if (!this.runtimeReady)
      throw new AgentServiceError(
        'SESSION_NOT_READY',
        'Agent runtime is not ready for commands',
        409,
      );
    const runtime = this.runtime!;
    const sessionId = this.sessionId!;
    if (command.type === 'interaction.respond') {
      runtime.respondInteraction(
        command.payload.interactionId,
        sessionId,
        command.payload.response,
      );
      this.ack(command);
      return;
    }
    if (command.type === 'interaction.cancel') {
      runtime.cancelInteraction(command.payload.interactionId, sessionId);
      this.ack(command);
      return;
    }
    if (command.type === 'agent.prompt') {
      let accepted = false;
      void runtime
        .prompt(
          sessionId,
          command.payload.text,
          this.previewClientId,
          command.payload.promptRequestId,
          () => {
            accepted = true;
            this.ack(command);
          },
          command.payload.attachments,
          this.userId,
          command.payload.modelProfileId,
        )
        .catch((error) => {
          if (!accepted) this.sendError(command.requestId, asAgentServiceError(error), command);
        });
      return;
    }
    if (command.type === 'session.compact') {
      await runtime.compact(sessionId);
      this.ack(command);
      return;
    }
    if (command.type === 'agent.abort') {
      await runtime.abort(sessionId);
      this.ack(command);
      return;
    }
    if (command.type === 'agent.steer') {
      await runtime.steer(sessionId, command.payload.text);
      this.ack(command);
      return;
    }
    await runtime.followUp(sessionId, command.payload.text);
    this.ack(command);
  }

  private requireAttached(command: AgentCommand): void {
    if (
      !this.runtime ||
      this.websiteId !== command.websiteId ||
      this.sessionId !== command.sessionId
    )
      throw new AgentServiceError(
        'SESSION_NOT_FOUND',
        'attach a WebsiteSession before sending agent commands',
        409,
      );
  }

  private ack(command: AgentCommand): void {
    this.send('command.ack', { commandType: command.type }, command.requestId);
  }

  private sendError(requestId: string, error: AgentServiceError, command?: AgentCommand): void {
    this.send(
      'command.error',
      { code: error.code, message: error.message },
      requestId,
      command?.websiteId,
    );
  }

  private send(
    type: string,
    payload: unknown,
    requestId = `server:${this.connectionId}`,
    websiteId = this.websiteId,
  ): void {
    this.write(
      createAgentEnvelope({ type, requestId, websiteId, sessionId: this.sessionId, payload }),
    );
  }

  private write(message: ReturnType<typeof createAgentEnvelope>): void {
    if (!this.closed && this.socket.readyState === this.socket.OPEN)
      this.socket.send(JSON.stringify(message));
  }

  private dispose(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    logger.info(
      {
        connectionId: this.connectionId,
        code: code ?? 'disposed',
        ...(reason ? { reason: reason.slice(0, 256) } : {}),
      },
      'agent websocket closed',
    );
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.runtimeReady = false;
    if (this.previewWebsiteId && this.previewClientId)
      this.options.previewClients.unregister(
        this.previewWebsiteId,
        this.previewClientId,
        this.previewConnection,
      );
    this.onClose();
  }
}

function socketContext(request: import('node:http').IncomingMessage): LogContext {
  const requestIdHeader = request.headers['x-request-id'];
  return {
    requestId:
      typeof requestIdHeader === 'string' && requestIdHeader.length > 0
        ? requestIdHeader
        : createRequestId(),
    ...parseTraceparent(
      typeof request.headers.traceparent === 'string' ? request.headers.traceparent : undefined,
    ),
    operation: 'agent.websocket.upgrade',
  };
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
  return {
    id: session.id,
    title: session.title,
    status: session.status === 'ACTIVE' ? 'ACTIVE' : session.status,
    piSessionId: session.piSessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActiveAt: session.lastActiveAt,
    pinnedAt: session.pinnedAt,
    clonedFromSessionId: session.clonedFromSessionId,
  } as const;
}
