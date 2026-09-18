import { describe, expect, it, vi } from 'vitest';
import type { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { buildAgentServiceApp } from './app.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';

const websiteId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';

const config = {
  port: 0,
  webOrigin: 'http://localhost:3000',
  workspaceGatewayEndpoint: 'http://localhost:4102',
  workspaceGatewayClientToken: 'test-token',
  agentDataRoot: '.test-data',
  previewGatewayOriginTemplate: 'https://site-{websiteId}.preview.example/',
  previewSigningSecret: 'test-preview-signing-secret',
  previewTokenTtlSeconds: 20,
  modelProvider: undefined,
  modelId: undefined,
  modelAuthPath: undefined,
  referenceRoot: 'D:/tmp/cloudcrane-references',
  referenceUploadMaxBytes: 100 * 1024 * 1024,
  modelConfigured: false,
};

function createRuntime() {
  const session = {
    id: sessionId,
    websiteId,
    piSessionId: 'pi-session',
    sessionFile: `${websiteId}/agent/sessions/session.jsonl`,
    title: 'Original',
    pinnedAt: null,
    clonedFromSessionId: null,
    status: 'ACTIVE' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    session,
    listSessions: vi.fn(async () => [session]),
    createSession: vi.fn(async () => session),
    renameSession: vi.fn(async (_id: string, title: string) => ({ ...session, title })),
    setSessionPinned: vi.fn(async (_id: string, pinned: boolean) => ({
      ...session,
      pinnedAt: pinned ? '2026-01-02T00:00:00.000Z' : null,
    })),
    cloneSession: vi.fn(async () => ({
      ...session,
      id: '00000000-0000-4000-8000-000000000003',
      piSessionId: 'pi-session-clone',
      sessionFile: `${websiteId}/agent/sessions/clone.jsonl`,
      title: 'Original (2)',
      clonedFromSessionId: sessionId,
    })),
    deleteSession: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  } as unknown as WebsiteAgentRuntime;
}

function createApp(runtime: WebsiteAgentRuntime) {
  return buildAgentServiceApp({
    config,
    registry: new WebsiteRuntimeRegistry({
      bindingStore: {
        findWebsiteWorkspace: async () => ({
          websiteId,
          workspaceId: '00000000-0000-4000-8000-000000000004',
          websiteStatus: 'ready',
          workspaceStatus: 'running',
        }),
      },
      createRuntime: async () => runtime,
    }),
  });
}

describe('session management REST endpoints', () => {
  it('routes rename, pin, clone, and delete through the runtime boundary', async () => {
    const runtime = createRuntime();
    const app = createApp(runtime);
    const base = `/v1/websites/${websiteId}/sessions/${sessionId}`;

    const renamed = await app.inject({
      method: 'PATCH',
      url: base,
      payload: { title: 'Renamed' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(runtime.renameSession).toHaveBeenCalledWith(sessionId, 'Renamed');

    const pinned = await app.inject({ method: 'PATCH', url: base, payload: { pinned: true } });
    expect(pinned.statusCode).toBe(200);
    expect(runtime.setSessionPinned).toHaveBeenCalledWith(sessionId, true);

    const combined = await app.inject({
      method: 'PATCH',
      url: base,
      payload: { title: 'Renamed again', pinned: false },
    });
    expect(combined.statusCode).toBe(400);

    const cloned = await app.inject({ method: 'POST', url: `${base}/clone` });
    expect(cloned.statusCode).toBe(200);
    expect(cloned.json().session.clonedFromSessionId).toBe(sessionId);

    const deleted = await app.inject({ method: 'DELETE', url: base });
    expect(deleted.statusCode).toBe(204);
    expect(runtime.deleteSession).toHaveBeenCalledWith(sessionId);
    await app.close();
  });
});
