import { describe, expect, it, vi } from 'vitest';
import type { CloudCraneAuth } from '@cloudcrane/auth';
import type { PlatformDb } from '@cloudcrane/db';
import { buildAgentServiceApp } from './app.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';

const websiteId = '00000000-0000-4000-8000-000000000001';
const userId = 'user-a';

function createRegistry() {
  const findWebsiteWorkspace = vi.fn(async () => null);
  return new WebsiteRuntimeRegistry({
    bindingStore: {
      findWebsiteWorkspace,
    },
    createRuntime: vi.fn(async () => {
      throw new Error('runtime should not be created by an authorization test');
    }),
  });
}

function createAuth(session: unknown): CloudCraneAuth {
  return {
    api: {
      getSession: vi.fn(async () => session),
    },
  } as unknown as CloudCraneAuth;
}

function createDb(ownerId: string | null) {
  return {
    query: {
      website: {
        findFirst: vi.fn(async () => ({ id: websiteId, ownerId })),
      },
    },
  } as unknown as PlatformDb['db'];
}

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

describe('agent service authorization', () => {
  it('rejects anonymous REST access before touching website runtime', async () => {
    const registry = createRegistry();
    const app = buildAgentServiceApp({
      config,
      registry,
      auth: createAuth(null),
      db: createDb(userId),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/websites/${websiteId}/sessions`,
      headers: { origin: config.webOrigin },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'AUTHENTICATION_REQUIRED', message: 'authentication required' },
    });
    await app.close();
  });

  it('rejects a user who does not own the website', async () => {
    const registry = createRegistry();
    const app = buildAgentServiceApp({
      config,
      registry,
      auth: createAuth({ user: { id: userId, role: 'user' } }),
      db: createDb('user-b'),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/websites/${websiteId}/preview`,
      headers: { origin: config.webOrigin },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: 'WEBSITE_FORBIDDEN', message: 'website access is forbidden' },
    });
    await app.close();
  });

  it('allows the owner through CORS and session checks before runtime lookup', async () => {
    const registry = createRegistry();
    const app = buildAgentServiceApp({
      config,
      registry,
      auth: createAuth({ user: { id: userId, role: 'user' } }),
      db: createDb(userId),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/websites/${websiteId}/sessions`,
      headers: { origin: config.webOrigin },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['access-control-allow-origin']).toBe(config.webOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    await app.close();
  });
});
