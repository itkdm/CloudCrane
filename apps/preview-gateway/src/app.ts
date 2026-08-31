import http from 'node:http';
import { URL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { verifyPreviewToken } from '@cloudcrane/preview-access';
import type { PreviewGatewayConfig } from './config.js';
import type { PreviewBinding, PreviewBindingStore } from './store.js';

const previewCookie = '__cloudcrane_preview';
const allowedWebsiteStatuses = new Set([
  'active',
  'ready',
  'running',
  'ACTIVE',
  'READY',
  'RUNNING',
]);
const allowedWorkspaceStatuses = new Set([
  'created',
  'running',
  'ready',
  'active',
  'STARTED',
  'RUNNING',
]);

export function buildPreviewGatewayApp(
  config: PreviewGatewayConfig,
  store: PreviewBindingStore,
): FastifyInstance {
  const app = Fastify({ bodyLimit: 16 * 1024 * 1024 });
  app.get('/health', async () => ({ service: 'preview-gateway', status: 'ok' }));
  app.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/*',
    handler: async (request, reply) => {
      const host = parsePreviewHost(request.headers.host, config.hostSuffixes);
      if (!host) return reply.code(404).send({ error: 'preview host is invalid' });
      const binding = await store.find(host.websiteId);
      if (!isPreviewReady(binding))
        return reply.code(404).send({ error: 'preview is unavailable' });

      const token = tokenFromRequest(request);
      const claims = verifyPreviewToken(token ?? '', config.signingSecret);
      if (!claims || claims.websiteId !== host.websiteId)
        return reply.code(401).send({ error: 'preview authorization is required' });
      if (!tokenFromCookie(request) && token) {
        const target = new URL(request.url, `http://${request.headers.host}`);
        target.searchParams.delete('token');
        reply.header(
          'set-cookie',
          `${previewCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(1, claims.expiresAt - Math.floor(Date.now() / 1000))}`,
        );
        return reply.redirect(target.pathname + target.search, 302);
      }
      reply.hijack();
      return proxyRequest(request, reply, host.publicHost, binding.previewPort!);
    },
  });
  return app;
}

function parsePreviewHost(
  value: string | undefined,
  suffixes: string[],
): { websiteId: string; publicHost: string } | null {
  if (!value || value.includes(',')) return null;
  const host = value.split(':')[0]?.toLowerCase();
  if (!host) return null;
  const match =
    /^site-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(.+)$/i.exec(
      host,
    );
  if (!match || !suffixes.some((suffix) => match[2] === suffix.toLowerCase())) return null;
  return { websiteId: match[1]!, publicHost: host };
}

function isPreviewReady(
  binding: PreviewBinding | null,
): binding is PreviewBinding & { previewPort: number } {
  return Boolean(
    binding &&
    allowedWebsiteStatuses.has(binding.websiteStatus) &&
    allowedWorkspaceStatuses.has(binding.workspaceStatus) &&
    binding.previewPort &&
    Number.isInteger(binding.previewPort) &&
    binding.previewPort > 0 &&
    binding.previewPort < 65536,
  );
}

function tokenFromRequest(request: FastifyRequest): string | undefined {
  const url = new URL(request.url, 'http://preview.invalid');
  return url.searchParams.get('token') ?? tokenFromCookie(request);
}

function tokenFromCookie(request: FastifyRequest): string | undefined {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${previewCookie}=`));
  if (!cookie) return undefined;
  try {
    return decodeURIComponent(cookie.slice(previewCookie.length + 1));
  } catch {
    return undefined;
  }
}

function proxyRequest(
  request: FastifyRequest,
  reply: {
    raw: {
      writeHead: (status: number, headers: http.OutgoingHttpHeaders) => void;
      end: () => void;
    };
  },
  publicHost: string,
  port: number,
): Promise<void> {
  return new Promise((resolve) => {
    const headers = { ...request.headers };
    delete headers.host;
    delete headers.cookie;
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port,
        method: request.method,
        path: upstreamPath(request.url, publicHost),
        headers: { ...headers, host: `127.0.0.1:${port}` },
      },
      (response) => {
        const responseHeaders = { ...response.headers, 'x-robots-tag': 'noindex, nofollow' };
        if (typeof responseHeaders.location === 'string')
          responseHeaders.location = rewriteInternalLocation(responseHeaders.location, publicHost);
        reply.raw.writeHead(response.statusCode ?? 502, responseHeaders);
        response.pipe(reply.raw as unknown as NodeJS.WritableStream);
        response.on('end', resolve);
      },
    );
    upstream.on('error', () => {
      reply.raw.writeHead(502, { 'content-type': 'text/plain', 'x-robots-tag': 'noindex' });
      reply.raw.end();
      resolve();
    });
    request.raw.pipe(upstream);
  });
}

function rewriteInternalLocation(location: string, publicHost: string): string {
  try {
    const parsed = new URL(location);
    if (['127.0.0.1', 'localhost', '0.0.0.0'].includes(parsed.hostname) && parsed.port === '8080') {
      parsed.protocol = 'http:';
      parsed.hostname = publicHost;
      parsed.port = '';
      return parsed.toString();
    }
  } catch {
    /* relative or malformed external locations are preserved */
  }
  return location;
}

function upstreamPath(requestUrl: string, publicHost: string): string {
  const url = new URL(requestUrl, `http://${publicHost}`);
  url.searchParams.delete('token');
  return url.pathname + url.search;
}
