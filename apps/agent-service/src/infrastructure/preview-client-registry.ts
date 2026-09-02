import { randomUUID } from 'node:crypto';
import { createAgentEnvelope, type AgentWireMessage } from '@cloudcrane/agent-protocol';
import {
  previewResponsePayloadSchema,
  isWebsiteRelativePath,
  type PreviewCapability,
  type PreviewObservation,
  type PreviewRequestPayload,
} from '@cloudcrane/preview-protocol';
import type {
  PreviewObservationContext,
  PreviewObservationProvider,
} from '@cloudcrane/website-agent';

export type PreviewClientConnection = {
  send(message: AgentWireMessage): void;
};

export type PreviewClientErrorCode =
  | 'INVALID_ARGUMENT'
  | 'CLIENT_UNAVAILABLE'
  | 'CLIENT_PREVIEW_TIMEOUT'
  | 'PREVIEW_CAPABILITY_UNAVAILABLE'
  | 'PREVIEW_PROTOCOL_ERROR';

export class PreviewClientError extends Error {
  constructor(
    public readonly code: PreviewClientErrorCode,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'PreviewClientError';
  }
}

type PendingRequest = {
  timer: ReturnType<typeof setTimeout>;
  resolve: (observation: PreviewObservation) => void;
  reject: (error: PreviewClientError) => void;
};

type RegisteredClient = {
  websiteId: string;
  previewClientId: string;
  capabilities?: Set<PreviewCapability>;
  connection: PreviewClientConnection;
  pending: Map<string, PendingRequest>;
};

const operationCapabilities: Record<PreviewRequestPayload['operation'], PreviewCapability[]> = {
  observe: ['DOM_SNAPSHOT', 'VISIBLE_TEXT', 'CONSOLE', 'WINDOW_ERRORS', 'VIEWPORT', 'CURRENT_URL'],
  refresh: ['DOM_SNAPSHOT', 'VISIBLE_TEXT', 'CONSOLE', 'WINDOW_ERRORS', 'VIEWPORT', 'CURRENT_URL'],
  navigate: ['DOM_SNAPSHOT', 'VISIBLE_TEXT', 'CONSOLE', 'WINDOW_ERRORS', 'VIEWPORT', 'CURRENT_URL'],
};

export class PreviewClientRegistry implements PreviewObservationProvider {
  private readonly clients = new Map<string, RegisteredClient>();

  constructor(
    private readonly timeouts: { observeMs?: number; refreshMs?: number; navigateMs?: number } = {},
  ) {}

  register(
    websiteId: string,
    previewClientId: string,
    capabilities: PreviewCapability[] | undefined,
    connection: PreviewClientConnection,
  ): void {
    const key = this.key(websiteId, previewClientId);
    const previous = this.clients.get(key);
    if (previous && previous.connection !== connection) this.rejectPendingForDisconnect(previous);
    this.clients.set(key, {
      websiteId,
      previewClientId,
      ...(capabilities ? { capabilities: new Set(capabilities) } : {}),
      connection,
      pending: previous?.connection === connection ? previous.pending : new Map(),
    });
  }

  updateCapabilities(
    websiteId: string,
    previewClientId: string,
    capabilities: PreviewCapability[] | undefined,
    connection: PreviewClientConnection,
  ): boolean {
    const client = this.clients.get(this.key(websiteId, previewClientId));
    if (!client || client.connection !== connection) return false;
    if (capabilities) client.capabilities = new Set(capabilities);
    else delete client.capabilities;
    return true;
  }

  unregister(
    websiteId: string,
    previewClientId: string,
    connection: PreviewClientConnection,
  ): void {
    const key = this.key(websiteId, previewClientId);
    const current = this.clients.get(key);
    if (!current || current.connection !== connection) return;
    this.rejectPendingForDisconnect(current);
    this.clients.delete(key);
  }

  getCapabilities(websiteId: string, previewClientId: string): PreviewCapability[] {
    return [...(this.clients.get(this.key(websiteId, previewClientId))?.capabilities ?? [])];
  }

  respond(
    websiteId: string,
    previewClientId: string,
    requestId: string,
    payload: unknown,
    connection: PreviewClientConnection,
  ): boolean {
    const client = this.clients.get(this.key(websiteId, previewClientId));
    const pending = client?.pending.get(requestId);
    if (!client || client.connection !== connection || !pending) return false;
    client.pending.delete(requestId);
    clearTimeout(pending.timer);
    const parsed = previewResponsePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      pending.reject(new PreviewClientError('PREVIEW_PROTOCOL_ERROR', 'invalid Preview response'));
    } else if (parsed.data.ok) {
      pending.resolve(parsed.data.observation);
    } else {
      pending.reject(new PreviewClientError(parsed.data.error.code, parsed.data.error.message));
    }
    return true;
  }

  async observe(context: PreviewObservationContext): Promise<PreviewObservation> {
    return this.request(context, { operation: 'observe' });
  }

  async refresh(context: PreviewObservationContext): Promise<PreviewObservation> {
    return this.request(context, { operation: 'refresh' });
  }

  async navigate(context: PreviewObservationContext, path: string): Promise<PreviewObservation> {
    if (!isWebsiteRelativePath(path))
      return Promise.reject(
        new PreviewClientError(
          'INVALID_ARGUMENT',
          'preview_navigate path must be a Website-relative path',
        ),
      );
    return this.request(context, { operation: 'navigate', path });
  }

  rejectPendingForDisconnect(client: RegisteredClient): void {
    const error = new PreviewClientError(
      'CLIENT_UNAVAILABLE',
      'the Preview Client disconnected before completing the request',
    );
    for (const pending of client.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    client.pending.clear();
  }

  close(): void {
    for (const client of this.clients.values()) this.rejectPendingForDisconnect(client);
    this.clients.clear();
  }

  private request(
    context: PreviewObservationContext,
    payload: PreviewRequestPayload,
  ): Promise<PreviewObservation> {
    if (!context.previewClientId)
      return Promise.reject(
        new PreviewClientError(
          'CLIENT_UNAVAILABLE',
          "the user's current Preview Client is unavailable",
        ),
      );
    const client = this.clients.get(this.key(context.websiteId, context.previewClientId));
    if (!client)
      return Promise.reject(
        new PreviewClientError('CLIENT_UNAVAILABLE', 'the requested Preview Client is unavailable'),
      );
    const required = operationCapabilities[payload.operation] ?? [];
    const capabilities = client.capabilities;
    if (capabilities && required.some((capability) => !capabilities.has(capability)))
      return Promise.reject(
        new PreviewClientError(
          'PREVIEW_CAPABILITY_UNAVAILABLE',
          `Preview Client does not provide ${required.join(', ')}`,
        ),
      );
    const requestId = randomUUID();
    const timeoutMs =
      payload.operation === 'observe'
        ? (this.timeouts.observeMs ?? 20_000)
        : payload.operation === 'refresh'
          ? (this.timeouts.refreshMs ?? 25_000)
          : (this.timeouts.navigateMs ?? 25_000);
    return new Promise<PreviewObservation>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.pending.delete(requestId);
        reject(
          new PreviewClientError('CLIENT_PREVIEW_TIMEOUT', 'Preview Client request timed out'),
        );
      }, timeoutMs);
      client.pending.set(requestId, { timer, resolve, reject });
      try {
        client.connection.send(
          createAgentEnvelope({
            type: 'preview.request',
            requestId,
            websiteId: context.websiteId,
            sessionId: context.websiteSessionId,
            runId: context.runId,
            traceId: context.traceId,
            payload,
          }),
        );
      } catch {
        client.pending.delete(requestId);
        clearTimeout(timer);
        reject(new PreviewClientError('CLIENT_UNAVAILABLE', 'Preview Client is not writable'));
      }
    });
  }

  private key(websiteId: string, previewClientId: string): string {
    return `${websiteId}:${previewClientId}`;
  }
}
