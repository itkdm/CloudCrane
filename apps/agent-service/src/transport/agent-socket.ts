import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  agentCommandSchema,
  createAgentEnvelope,
  type AgentCommand,
} from '@cloudcrane/agent-protocol';
import type { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { AgentServiceError, asAgentServiceError } from '../application/errors.js';
import { WebsiteRuntimeRegistry } from '../application/runtime-registry.js';
import type { AgentServiceConfig } from '../config.js';
import { PreviewClientRegistry } from '../infrastructure/preview-client-registry.js';
import { projectWebsiteAgentEvent } from './agent-event-projector.js';

type AgentSocketOptions = {
  app: FastifyInstance;
  config: AgentServiceConfig;
  registry: WebsiteRuntimeRegistry;
  previewClients: PreviewClientRegistry;
};

export class AgentSocketTransport {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  private readonly connections = new Set<AgentSocketConnection>();

  constructor(private readonly options: AgentSocketOptions) {
    options.app.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/v1/agent/connect') return;
      const origin = request.headers.origin;
      if (origin && origin !== options.config.webOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.server.handleUpgrade(request, socket, head, (ws) => {
        const connection = new AgentSocketConnection(ws, this.options, () =>
          this.connections.delete(connection),
        );
        this.connections.add(connection);
      });
    });
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  async close(): Promise<void> {
    for (const connection of this.connections) connection.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

class AgentSocketConnection {
  private readonly connectionId = randomUUID();
  private runtime?: WebsiteAgentRuntime;
  private sessionId?: string;
  private unsubscribe?: () => void;
  private websiteId?: string;
  private closed = false;
  private previewWebsiteId?: string;
  private previewClientId?: string;
  private readonly previewConnection = {
    send: (message: ReturnType<typeof createAgentEnvelope>) => this.write(message),
  };

  constructor(
    private readonly socket: WebSocket,
    private readonly options: AgentSocketOptions,
    private readonly onClose: () => void,
  ) {
    socket.on('message', (raw) => void this.handleMessage(raw.toString()));
    socket.on('close', () => this.dispose());
    socket.on('error', () => this.dispose());
    this.send('connection.ready', { connectionId: this.connectionId });
  }

  close(): void {
    this.socket.close();
    this.dispose();
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
    try {
      await this.dispatch(command);
    } catch (error) {
      this.sendError(command.requestId, asAgentServiceError(error), command);
    }
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
      let session;
      try {
        session = await runtime.openSession(command.payload.sessionId);
      } catch {
        throw new AgentServiceError('SESSION_NOT_FOUND', 'website session was not found', 404);
      }
      this.unsubscribe?.();
      this.runtime = runtime;
      this.websiteId = command.websiteId;
      this.sessionId = session.id;
      this.unsubscribe = runtime.subscribe((event) => {
        if (event.websiteSessionId !== this.sessionId) return;
        const message = projectWebsiteAgentEvent(event);
        if (message) this.write(message);
      });
      this.ack(command);
      this.send('session.attached', { session: toSessionView(session) });
      const snapshot = await runtime.getSessionSnapshot(session.id);
      this.send('session.snapshot', {
        session: toSessionView(snapshot.session),
        messages: snapshot.messages,
        activeRun: snapshot.activeRun,
      });
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
    if (command.type === 'preview.response') {
      if (this.previewWebsiteId !== command.websiteId || !this.previewClientId)
        throw new AgentServiceError('INVALID_ARGUMENT', 'Preview Client is not registered', 400);
      if (
        !this.options.previewClients.respond(
          command.websiteId,
          this.previewClientId,
          command.requestId,
          command.payload,
          this.previewConnection,
        )
      )
        throw new AgentServiceError('INVALID_ARGUMENT', 'Preview response is not pending', 400);
      return;
    }
    this.requireAttached(command);
    const runtime = this.runtime!;
    const sessionId = this.sessionId!;
    if (command.type === 'agent.prompt') {
      if (!this.options.config.modelConfigured)
        throw new AgentServiceError('MODEL_NOT_CONFIGURED', 'agent model is not configured', 503);
      if (await runtime.hasActiveRun(sessionId))
        throw new AgentServiceError('SESSION_BUSY', 'this session already has an active run', 409);
      this.ack(command);
      void runtime
        .prompt(
          sessionId,
          command.payload.text,
          this.previewClientId,
          command.payload.promptRequestId,
        )
        .catch(() => undefined);
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

  private dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.previewWebsiteId && this.previewClientId)
      this.options.previewClients.unregister(
        this.previewWebsiteId,
        this.previewClientId,
        this.previewConnection,
      );
    this.onClose();
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
  return {
    id: session.id,
    title: session.title,
    status: session.status === 'ACTIVE' ? 'ACTIVE' : session.status,
    piSessionId: session.piSessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActiveAt: session.lastActiveAt,
  } as const;
}
