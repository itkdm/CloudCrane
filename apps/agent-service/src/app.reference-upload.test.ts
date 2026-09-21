import { describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import type { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { buildAgentServiceApp } from './app.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';

const websiteId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const interactionId = '00000000-0000-4000-8000-000000000003';

function multipartZip(content: string): { body: Buffer; contentType: string } {
  const boundary = 'cloudcrane-test-boundary';
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="site.zip"\r\nContent-Type: application/zip\r\n\r\n${content}\r\n--${boundary}--\r\n`,
  );
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('reference upload route', () => {
  it('enforces the configured archive limit before materialization', async () => {
    const runtime = {
      workspaceId: '00000000-0000-4000-0000-000000000004',
      isReferenceUploadPending: () => true,
      resolveReferenceUpload: () => undefined,
      recoverStaleRuns: async () => undefined,
      shutdown: async () => undefined,
    } as unknown as WebsiteAgentRuntime;
    const app = buildAgentServiceApp({
      config: {
        port: 0,
        webOrigin: 'http://localhost:3000',
        workspaceGatewayEndpoint: 'http://localhost:4102',
        workspaceGatewayClientToken: 'test-token',
        agentDataRoot: '.test-data',
        previewGatewayOriginTemplate: 'https://{previewSlug}.preview.example/',
        previewSigningSecret: 'test-preview-signing-secret',
        previewTokenTtlSeconds: 20,
        modelProvider: undefined,
        modelId: undefined,
        modelAuthPath: undefined,
        referenceRoot: '.test-reference-upload-data',
        referenceUploadMaxBytes: 4,
        modelConfigured: false,
      },
      registry: new WebsiteRuntimeRegistry({
        bindingStore: {
          findWebsiteWorkspace: async () => ({
            websiteId,
            workspaceId: runtime.workspaceId,
            websiteStatus: 'ready',
            workspaceStatus: 'running',
            previewPort: 4103,
          }),
        },
        createRuntime: async () => runtime,
      }),
    });
    const multipart = multipartZip('12345');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/websites/${websiteId}/sessions/${sessionId}/interactions/${interactionId}/reference-upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    });
    expect(response.statusCode).toBe(413);
    await app.close();
    await rm('.test-reference-upload-data', { recursive: true, force: true });
  });

  it('allows uploads larger than the default JSON body limit to reach multipart validation', async () => {
    const runtime = {
      workspaceId: '00000000-0000-4000-0000-000000000004',
      isReferenceUploadPending: () => true,
      resolveReferenceUpload: () => undefined,
      recoverStaleRuns: async () => undefined,
      shutdown: async () => undefined,
    } as unknown as WebsiteAgentRuntime;
    const app = buildAgentServiceApp({
      config: {
        port: 0,
        webOrigin: 'http://localhost:3000',
        workspaceGatewayEndpoint: 'http://localhost:4102',
        workspaceGatewayClientToken: 'test-token',
        agentDataRoot: '.test-data',
        previewGatewayOriginTemplate: 'https://{previewSlug}.preview.example/',
        previewSigningSecret: 'test-preview-signing-secret',
        previewTokenTtlSeconds: 20,
        modelProvider: undefined,
        modelId: undefined,
        modelAuthPath: undefined,
        referenceRoot: '.test-reference-upload-data',
        referenceUploadMaxBytes: 100 * 1024 * 1024,
        modelConfigured: false,
      },
      registry: new WebsiteRuntimeRegistry({
        bindingStore: {
          findWebsiteWorkspace: async () => ({
            websiteId,
            workspaceId: runtime.workspaceId,
            websiteStatus: 'ready',
            workspaceStatus: 'running',
            previewPort: 4103,
          }),
        },
        createRuntime: async () => runtime,
      }),
    });
    const multipart = multipartZip('x'.repeat(300 * 1024));
    const response = await app.inject({
      method: 'POST',
      url: `/v1/websites/${websiteId}/sessions/${sessionId}/interactions/${interactionId}/reference-upload`,
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    });
    expect(response.statusCode).toBe(422);
    await app.close();
    await rm('.test-reference-upload-data', { recursive: true, force: true });
  });
});
