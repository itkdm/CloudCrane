import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { signPreviewToken } from '@cloudcrane/preview-access';
import { buildPreviewGatewayApp } from './app.js';
import type { PreviewGatewayConfig } from './config.js';

const websiteId = '00000000-0000-4000-8000-000000000001';
const secret = 'test-preview-signing-secret';
const config: PreviewGatewayConfig = {
  port: 0,
  signingSecret: secret,
  hostSuffixes: ['localhost'],
};
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('Preview Gateway', () => {
  it('authenticates from Host, sets a cookie, and streams the preview response', async () => {
    let seenPath = '';
    const upstream = http.createServer((request, response) => {
      seenPath = request.url ?? '';
      response.setHeader('content-type', 'text/html');
      response.end(`<h1>${request.url}</h1>`);
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
    const upstreamPort = (upstream.address() as { port: number }).port;
    const app = buildPreviewGatewayApp(config, {
      find: async () => ({
        websiteId,
        websiteStatus: 'active',
        workspaceStatus: 'running',
        previewPort: upstreamPort,
      }),
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('gateway did not bind');
    const token = signPreviewToken(
      { websiteId, expiresAt: Math.floor(Date.now() / 1000) + 60 },
      secret,
    );
    const previewHost = `site-${websiteId}.localhost:4103`;
    const first = await request(address.port, '/index.php?token=' + token, previewHost);
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/index.php');
    const cookie = first.headers['set-cookie']?.[0];
    expect(cookie).toContain('__cloudcrane_preview=');
    const second = await request(address.port, '/index.php', previewHost, cookie!.split(';')[0]);
    expect(second.status).toBe(200);
    expect(second.body).toContain('/index.php');
    expect(second.headers['x-robots-tag']).toContain('noindex');
    expect(seenPath).not.toContain('token=');
    await app.close();
  });

  it('rejects arbitrary hosts and missing preview authorization', async () => {
    const app = buildPreviewGatewayApp(config, { find: async () => null });
    const invalidHost = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'localhost:4103' },
    });
    expect(invalidHost.statusCode).toBe(404);
    await app.close();
  });
});

function request(port: number, path: string, host: string, cookie?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const request = http.request(
        { host: '127.0.0.1', port, path, headers: { host, ...(cookie ? { cookie } : {}) } },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    },
  );
}
