import http from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProductionGatewayServer, parseProductionSlug } from './app.js';
import type { ProductionBinding } from './store.js';

const slug = '0123456789abcdef0123456789abcdef';
const binding: ProductionBinding = {
  websiteId: '00000000-0000-4000-8000-000000000001',
  productionSlug: slug,
  status: 'active',
  productionPort: 43123,
};
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('Production Gateway Host routing', () => {
  it('accepts one generated slug under the configured suffix and rejects other hosts', () => {
    expect(parseProductionSlug(`${slug}.sites.example.test:443`, 'sites.example.test')).toBe(slug);
    expect(parseProductionSlug(`${slug}.other.test`, 'sites.example.test')).toBeNull();
    expect(
      parseProductionSlug(`other.${slug}.sites.example.test`, 'sites.example.test'),
    ).toBeNull();
    expect(parseProductionSlug(`www.sites.example.test`, 'sites.example.test')).toBeNull();
    expect(
      parseProductionSlug(`${slug}.sites.example.test, attacker.test`, 'sites.example.test'),
    ).toBeNull();
  });

  it('streams supported methods to the bound runtime with production forwarding headers', async () => {
    const upstream = http.createServer((request, response) => {
      response.setHeader('location', '/finished');
      response.setHeader('set-cookie', 'site_session=present; Path=/; HttpOnly');
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      request.on('end', () =>
        response.end(
          JSON.stringify({
            method: request.method,
            url: request.url,
            host: request.headers.host,
            forwardedHost: request.headers['x-forwarded-host'],
            forwardedProto: request.headers['x-forwarded-proto'],
            cookie: request.headers.cookie,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        ),
      );
    });
    servers.push(upstream);
    await listen(upstream);
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string')
      throw new Error('upstream did not bind');
    const store = {
      findBySlug: vi.fn(async () => ({ ...binding, productionPort: upstreamAddress.port })),
    };
    const gateway = buildProductionGatewayServer(
      {
        port: 4104,
        hostSuffix: 'sites.example.test',
        publicProtocol: 'https',
        upstreamTimeoutMs: 10_000,
      },
      store,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    );
    servers.push(gateway);
    await listen(gateway);
    const gatewayPort = gateway.address();
    if (!gatewayPort || typeof gatewayPort === 'string') throw new Error('gateway did not bind');

    const response = await requestGateway({
      port: gatewayPort.port,
      host: `${slug}.sites.example.test`,
      path: '/checkout?step=1',
      method: 'POST',
      headers: { cookie: 'cart=123', 'content-type': 'text/plain' },
      body: 'streamed',
    });
    const result = JSON.parse(response.body) as Record<string, string>;
    expect(response.statusCode).toBe(200);
    expect(response.headers.location).toBe('/finished');
    expect(response.headers['set-cookie']?.join(';')).toContain('site_session=present');
    expect(result).toMatchObject({
      method: 'POST',
      url: '/checkout?step=1',
      host: `${slug}.sites.example.test`,
      forwardedHost: `${slug}.sites.example.test`,
      forwardedProto: 'https',
      cookie: 'cart=123',
      body: 'streamed',
    });
  });

  it('returns 404 for unknown Host and for a runtime outside an allowed lifecycle state', async () => {
    const store = {
      findBySlug: vi.fn(async (requestedSlug: string) =>
        requestedSlug === slug ? { ...binding, status: 'provisioning' } : null,
      ),
    };
    const gateway = buildProductionGatewayServer(
      {
        port: 4104,
        hostSuffix: 'sites.example.test',
        publicProtocol: 'https',
        upstreamTimeoutMs: 10_000,
      },
      store,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    );
    servers.push(gateway);
    await listen(gateway);
    const address = gateway.address();
    if (!address || typeof address === 'string') throw new Error('gateway did not bind');

    const invalidHost = await requestGateway({
      port: address.port,
      host: 'unknown.sites.example.test',
    });
    const nonRoutableState = await requestGateway({
      port: address.port,
      host: `${slug}.sites.example.test`,
    });
    expect(invalidHost.statusCode).toBe(404);
    expect(nonRoutableState.statusCode).toBe(404);
    expect(store.findBySlug).toHaveBeenCalledOnce();
  });
});

async function listen(server: http.Server): Promise<void> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
}

async function requestGateway(input: {
  port: number;
  host: string;
  path?: string;
  method?: string;
  headers?: http.OutgoingHttpHeaders;
  body?: string;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: input.port,
        path: input.path ?? '/',
        method: input.method ?? 'GET',
        headers: { ...input.headers, host: input.host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.on('error', reject);
    if (input.body) request.write(input.body);
    request.end();
  });
}
