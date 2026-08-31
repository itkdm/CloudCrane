import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { WebsiteAgentRuntime, WebsiteSessionIndex } from '@cloudcrane/website-agent';
import { buildAgentServiceApp } from '../app.js';
import { WebsiteRuntimeRegistry } from '../application/runtime-registry.js';
import type { AgentServiceConfig } from '../config.js';

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
  modelConfigured: true,
};

describe('AgentSocketTransport', () => {
  let app: ReturnType<typeof buildAgentServiceApp>;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  const runtime = {
    openSession: async () => session,
    listSessions: async () => [session],
    createSession: async () => session,
    getSessionSnapshot: async () => ({ session, messages: [], activeRun: null }),
    hasActiveRun: async () => false,
    subscribe: () => {
      subscribeCount += 1;
      return () => {
        unsubscribeCount += 1;
      };
    },
    prompt: async () => ({
      runId: '00000000-0000-4000-8000-000000000003',
      traceId: '00000000-0000-4000-8000-000000000004',
      status: 'COMPLETED' as const,
    }),
    abort: async () => undefined,
    steer: async () => undefined,
    followUp: async () => undefined,
    shutdown: async () => undefined,
  } as unknown as WebsiteAgentRuntime;

  beforeEach(async () => {
    subscribeCount = 0;
    unsubscribeCount = 0;
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
    app = buildAgentServiceApp({ config, registry });
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
});
