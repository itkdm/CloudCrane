import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import type { WebsiteAgentRuntime, WebsiteSessionIndex } from '@cloudcrane/website-agent';
import { buildAgentServiceApp } from '../app.js';
import { WebsiteRuntimeRegistry } from '../application/runtime-registry.js';
import type { AgentServiceConfig } from '../config.js';
import { PreviewClientRegistry } from '../infrastructure/preview-client-registry.js';

const websiteId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const session: WebsiteSessionIndex = {
  id: sessionId,
  websiteId,
  piSessionId: 'pi-session',
  sessionFile: 'agent/session.jsonl',
  title: null,
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastActiveAt: null,
};
const config: AgentServiceConfig = {
  port: 0,
  webOrigin: 'http://localhost:3000',
  workspaceGatewayEndpoint: 'http://localhost:4102',
  workspaceGatewayClientToken: 'test-token',
  agentDataRoot: '.test-data',
  previewGatewayOriginTemplate: 'http://site-{websiteId}.localhost:4103/',
  previewSigningSecret: 'test-preview-signing-secret',
  previewTokenTtlSeconds: 600,
  modelProvider: undefined,
  modelId: undefined,
  modelAuthPath: undefined,
  referenceRoot: 'D:/tmp/cloudcrane-references',
  referenceUploadMaxBytes: 100 * 1024 * 1024,
  modelConfigured: true,
};

describe('AgentSocketTransport', () => {
  let app: ReturnType<typeof buildAgentServiceApp>;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  let runtimeBusy = false;
  let compactionError: unknown;
  let previewClients: PreviewClientRegistry;
  const runtime = {
    openSession: async () => session,
    listSessions: async () => [session],
    createSession: async () => session,
    getSessionSnapshot: async () => ({
      session,
      messages: [],
      contextMaintenance: null,
      activeRun: null,
    }),
    hasActiveRun: async () => false,
    subscribe: () => {
      subscribeCount += 1;
      return () => {
        unsubscribeCount += 1;
      };
    },
    prompt: vi.fn(
      async (
        _sessionId: string,
        _text: string,
        _previewClientId?: string,
        _promptRequestId?: string,
        onAccepted?: () => void,
      ) => {
        if (runtimeBusy) throw { code: 'SESSION_BUSY', message: 'session is busy' };
        onAccepted?.();
        return {
          runId: '00000000-0000-4000-8000-000000000003',
          traceId: '00000000-0000-4000-8000-000000000004',
          status: 'COMPLETED' as const,
        };
      },
    ),
    abort: async () => undefined,
    compact: vi.fn(async () => {
      if (compactionError) throw compactionError;
    }),
    steer: async () => undefined,
    followUp: async () => undefined,
    shutdown: async () => undefined,
  } as unknown as WebsiteAgentRuntime;

  beforeEach(async () => {
    subscribeCount = 0;
    unsubscribeCount = 0;
    runtimeBusy = false;
    compactionError = undefined;
    previewClients = new PreviewClientRegistry({ observeMs: 1_000 });
    const registry = new WebsiteRuntimeRegistry({
      bindingStore: {
        findWebsiteWorkspace: async () => ({
          websiteId,
          workspaceId: '00000000-0000-4000-8000-000000000003',
          websiteStatus: 'ACTIVE',
          workspaceStatus: 'running',
        }),
      },
      createRuntime: () => runtime,
    });
    app = buildAgentServiceApp({ config, registry, previewClientRegistry: previewClients });
    await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => {
    await app.close();
  });

  it('attaches and removes the runtime subscription on disconnect', async () => {
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/v1/agent/connect`);
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      client.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string };
        events.push(message.type);
        if (message.type === 'connection.ready') {
          client.send(
            JSON.stringify({
              type: 'session.attach',
              requestId: 'attach-1',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { sessionId },
            }),
          );
        }
        if (message.type === 'session.snapshot') resolve();
      });
      client.on('error', reject);
    });
    expect(events).toEqual([
      'connection.ready',
      'command.ack',
      'session.attached',
      'session.snapshot',
    ]);
    expect(subscribeCount).toBe(1);
    client.close();
    await new Promise((resolve) => client.once('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(unsubscribeCount).toBe(1);
    expect(app.agentSocket.connectionCount).toBe(0);
  });

  it('serves session indexes and enforces the configured HTTP origin', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: `/v1/websites/${websiteId}/sessions`,
      headers: { origin: config.webOrigin },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ sessions: [{ id: sessionId }] });
    expect(allowed.headers['access-control-allow-origin']).toBe(config.webOrigin);
    const forbidden = await app.inject({
      method: 'GET',
      url: `/v1/websites/${websiteId}/sessions`,
      headers: { origin: 'https://untrusted.example' },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('dispatches session compaction as a control command without starting a run', async () => {
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/v1/agent/connect`);
    await new Promise<void>((resolve, reject) => {
      client.on('error', reject);
      client.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string; requestId?: string };
        if (message.type === 'connection.ready') {
          client.send(
            JSON.stringify({
              type: 'session.attach',
              requestId: 'attach-compact',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { sessionId },
            }),
          );
        } else if (message.type === 'session.snapshot') {
          client.send(
            JSON.stringify({
              type: 'session.compact',
              requestId: 'compact-1',
              websiteId,
              sessionId,
              timestamp: new Date().toISOString(),
              payload: {},
            }),
          );
        } else if (message.type === 'command.ack' && message.requestId === 'compact-1') resolve();
      });
    });
    expect(runtime.compact).toHaveBeenCalledWith(sessionId);
    expect(runtime.prompt).not.toHaveBeenCalled();
    client.close();
  });

  it('keeps the socket usable after a not-needed compaction error', async () => {
    compactionError = {
      code: 'CONTEXT_COMPACTION_NOT_NEEDED',
      message: 'this conversation has no earlier context that needs organizing',
    };
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/v1/agent/connect`);
    const messages: Array<{ type: string; requestId?: string; payload?: { code?: string } }> = [];
    await new Promise<void>((resolve, reject) => {
      client.on('error', reject);
      client.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as (typeof messages)[number];
        messages.push(message);
        if (message.type === 'connection.ready')
          client.send(
            JSON.stringify({
              type: 'session.attach',
              requestId: 'attach-not-needed',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { sessionId },
            }),
          );
        else if (message.type === 'session.snapshot')
          client.send(
            JSON.stringify({
              type: 'session.compact',
              requestId: 'compact-not-needed',
              websiteId,
              sessionId,
              timestamp: new Date().toISOString(),
              payload: {},
            }),
          );
        else if (message.type === 'command.error' && message.requestId === 'compact-not-needed')
          client.send(
            JSON.stringify({
              type: 'agent.abort',
              requestId: 'abort-after-error',
              websiteId,
              sessionId,
              timestamp: new Date().toISOString(),
              payload: {},
            }),
          );
        else if (message.type === 'command.ack' && message.requestId === 'abort-after-error')
          resolve();
      });
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'command.error',
        requestId: 'compact-not-needed',
        payload: expect.objectContaining({ code: 'CONTEXT_COMPACTION_NOT_NEEDED' }),
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'command.ack', requestId: 'abort-after-error' }),
    );
    client.close();
  });

  it('does not acknowledge a prompt rejected by the runtime busy boundary', async () => {
    runtimeBusy = true;
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/v1/agent/connect`);
    const messages: Array<{ type: string; requestId?: string; payload?: { code?: string } }> = [];
    await new Promise<void>((resolve, reject) => {
      client.on('error', reject);
      client.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as (typeof messages)[number];
        messages.push(message);
        if (message.type === 'connection.ready') {
          client.send(
            JSON.stringify({
              type: 'session.attach',
              requestId: 'attach-busy',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { sessionId },
            }),
          );
        } else if (message.type === 'session.snapshot') {
          client.send(
            JSON.stringify({
              type: 'agent.prompt',
              requestId: 'prompt-busy',
              websiteId,
              sessionId,
              timestamp: new Date().toISOString(),
              payload: { text: 'busy prompt' },
            }),
          );
        } else if (message.type === 'command.error' && message.requestId === 'prompt-busy') {
          resolve();
        }
      });
    });
    expect(
      messages.some(
        (message) => message.type === 'command.ack' && message.requestId === 'prompt-busy',
      ),
    ).toBe(false);
    expect(messages.at(-1)).toMatchObject({
      type: 'command.error',
      requestId: 'prompt-busy',
      payload: { code: 'SESSION_BUSY' },
    });
    client.close();
  });

  it('keeps an in-flight preview request across same-client re-registration', async () => {
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/v1/agent/connect`);
    const previewClientId = '00000000-0000-4000-8000-000000000011';
    const preview = {
      url: 'https://preview.example/',
      path: '/',
      title: 'Preview',
      viewport: { width: 100, height: 100, devicePixelRatio: 1 },
      scroll: { x: 0, y: 0 },
      dom: [],
      domTruncated: false,
      visibleText: '',
      consoleErrors: [],
      windowErrors: [],
      capturedAt: new Date().toISOString(),
    };
    const previewCapabilities = [
      'DOM_SNAPSHOT',
      'VISIBLE_TEXT',
      'CONSOLE',
      'WINDOW_ERRORS',
      'VIEWPORT',
      'CURRENT_URL',
    ];
    let previewRequestId: string | undefined;
    const pending = new Promise<void>((resolve, reject) => {
      client.on('error', reject);
      client.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as {
          type: string;
          requestId?: string;
          payload?: { operation?: string };
        };
        if (message.type === 'connection.ready') {
          client.send(
            JSON.stringify({
              type: 'preview.client.register',
              requestId: 'register-1',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { previewClientId },
            }),
          );
          return;
        }
        if (message.type === 'command.ack' && message.requestId === 'register-1') {
          void previewClients
            .observe({
              websiteId,
              websiteSessionId: sessionId,
              runId: '00000000-0000-4000-8000-000000000003',
              traceId: '00000000-0000-4000-8000-000000000004',
              previewClientId,
            })
            .then(() => resolve(), reject);
          return;
        }
        if (message.type === 'preview.request' && message.payload?.operation === 'observe') {
          previewRequestId = message.requestId;
          client.send(
            JSON.stringify({
              type: 'preview.client.capabilities',
              requestId: 'register-2',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { previewClientId, capabilities: previewCapabilities },
            }),
          );
          return;
        }
        if (message.type === 'command.ack' && message.requestId === 'register-2') {
          if (!previewRequestId) return reject(new Error('preview request was not captured'));
          client.send(
            JSON.stringify({
              type: 'preview.response',
              requestId: previewRequestId,
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { ok: true, observation: preview },
            }),
          );
        }
      });
    });
    await expect(pending).resolves.toBeUndefined();
    client.close();
  });
});
