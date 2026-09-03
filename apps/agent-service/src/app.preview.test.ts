import { describe, expect, it } from 'vitest';
import { verifyPreviewToken } from '@cloudcrane/preview-access';
import { buildAgentServiceApp } from './app.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';

const websiteId = '00000000-0000-4000-8000-000000000001';

describe('preview access endpoint', () => {
  it('returns the same expiry used in the signed token', async () => {
    const app = buildAgentServiceApp({
      config: {
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
        modelConfigured: false,
      },
      registry: new WebsiteRuntimeRegistry({
        bindingStore: {
          findWebsiteWorkspace: async () => ({
            websiteId,
            workspaceId: '00000000-0000-4000-8000-000000000002',
            websiteStatus: 'ready',
            workspaceStatus: 'running',
            previewPort: 4103,
          }),
        },
        createRuntime: async () => {
          throw new Error('runtime should not be created by preview endpoint');
        },
      }),
    });

    const response = await app.inject({ method: 'GET', url: `/v1/websites/${websiteId}/preview` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { url: string; expiresAt: number };
    expect(body.url).toContain('?token=');
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(body.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 20);
    const token = new URL(body.url).searchParams.get('token');
    expect(token).not.toBeNull();
    expect(verifyPreviewToken(token!, 'test-preview-signing-secret')?.expiresAt).toBe(
      body.expiresAt,
    );
    await app.close();
  });
});
