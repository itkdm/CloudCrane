import http from 'node:http';
import { URL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { verifyPreviewToken } from '@cloudcrane/preview-access';
import type { PreviewGatewayConfig } from './config.js';
import { previewBridgeScript } from './bridge-asset.js';
import type { PreviewBinding, PreviewBindingStore } from './store.js';

export const PREVIEW_AUTH_COOKIE = '__cloudcrane_preview';
const MAX_HTML_INJECTION_BYTES = 2 * 1024 * 1024;
const allowedWebsiteStatuses = new Set([
  'active',
  'ready',
  'authorization_required',
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
  app.get('/__cloudcrane/preview-bridge.js', async (request, reply) => {
    const auth = await authenticate(request, config, store);
    if ('redirect' in auth) {
      reply.header('set-cookie', auth.cookie);
      return reply.redirect(auth.redirect, 302);
    }
    if (!auth.binding) return reply.code(auth.status).send({ error: auth.message });
    const script = await previewBridgeScript();
    reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'no-store, no-cache, must-revalidate')
      .header('x-robots-tag', 'noindex, nofollow');
    return script;
  });
  app.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/*',
    handler: async (request, reply) => {
      const auth = await authenticate(request, config, store);
      if ('redirect' in auth) {
        reply.header('set-cookie', auth.cookie);
        return reply.redirect(auth.redirect, 302);
      }
      if (!auth.binding) return reply.code(auth.status).send({ error: auth.message });
      reply.hijack();
      return proxyRequest(request, reply, auth.publicHost, auth.previewPort, config);
    },
  });
  return app;
}

async function authenticate(
  request: FastifyRequest,
  config: PreviewGatewayConfig,
  store: PreviewBindingStore,
): Promise<
  | { binding: PreviewBinding & { previewPort: number }; publicHost: string; previewPort: number }
  | { binding?: undefined; status: 401 | 404; message: string }
  | { binding?: undefined; redirect: string; cookie: string }
> {
  const host = parsePreviewHost(request.headers.host, config.hostSuffixes);
  if (!host) return { status: 404, message: 'preview host is invalid' };
  const binding = await store.find(host.websiteId);
  if (!isPreviewReady(binding)) return { status: 404, message: 'preview is unavailable' };

  const queryToken = tokenFromQuery(request);
  const cookieToken = tokenFromCookie(request);
  const token = queryToken ?? cookieToken;
  const claims = verifyPreviewToken(token ?? '', config.signingSecret);
  if (!claims || claims.websiteId !== host.websiteId)
    return { status: 401, message: 'preview authorization is required' };
  if (!cookieToken && queryToken) {
    const target = new URL(request.url, `http://${host.publicHost}`);
    target.searchParams.delete('token');
    return {
      redirect: target.pathname + target.search,
      cookie: serializePreviewCookie(queryToken, claims.expiresAt, config.cookieSecure),
    };
  }
  return { binding, publicHost: host.publicHost, previewPort: binding.previewPort };
}

function parsePreviewHost(
  value: string | undefined,
  suffixes: string[],
): { websiteId: string; publicHost: string; publicPort?: number } | null {
  if (!value || value.includes(',')) return null;
  const normalized = value.trim().toLowerCase();
  const match = /^(?<hostname>[^:]+)(?::(?<port>[0-9]{1,5}))?$/.exec(normalized);
  const hostname = match?.groups?.hostname;
  const portValue = match?.groups?.port;
  if (!hostname) return null;
  const website =
    /^site-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(.+)$/i.exec(
      hostname,
    );
  if (!website || !suffixes.some((suffix) => website[2] === suffix.toLowerCase())) return null;
  const publicPort = portValue ? Number(portValue) : undefined;
  if (publicPort !== undefined && (publicPort < 1 || publicPort > 65535)) return null;
  return {
    websiteId: website[1]!,
    publicHost: publicPort ? `${hostname}:${publicPort}` : hostname,
    publicPort,
  };
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

function tokenFromQuery(request: FastifyRequest): string | undefined {
  return new URL(request.url, 'http://preview.invalid').searchParams.get('token') ?? undefined;
}

function tokenFromCookie(request: FastifyRequest): string | undefined {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PREVIEW_AUTH_COOKIE}=`));
  if (!cookie) return undefined;
  try {
    return decodeURIComponent(cookie.slice(PREVIEW_AUTH_COOKIE.length + 1));
  } catch {
    return undefined;
  }
}

function serializePreviewCookie(token: string, expiresAt: number, secure: boolean): string {
  const sameSite = secure ? 'None' : 'Lax';
  return `${PREVIEW_AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${Math.max(1, expiresAt - Math.floor(Date.now() / 1000))}${secure ? '; Secure' : ''}`;
}

function proxyRequest(
  request: FastifyRequest,
  reply: {
    raw: {
      writeHead: (status: number, headers: http.OutgoingHttpHeaders) => void;
      end: (chunk?: string | Buffer) => void;
      write: (chunk: Buffer) => boolean;
    };
  },
  publicHost: string,
  port: number,
  config: PreviewGatewayConfig,
): Promise<void> {
  return new Promise((resolve) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port,
        method: request.method,
        path: upstreamPath(request.url, publicHost),
        headers: forwardedHeaders(request, publicHost, config.publicProtocol),
      },
      (response) => void handleUpstreamResponse(response, reply, publicHost, config, resolve),
    );
    upstream.on('error', () => {
      reply.raw.writeHead(502, { 'content-type': 'text/plain', 'x-robots-tag': 'noindex' });
      reply.raw.end('Preview upstream is unavailable');
      resolve();
    });
    request.raw.pipe(upstream);
  });
}

function forwardedHeaders(
  request: FastifyRequest,
  publicHost: string,
  publicProtocol: PreviewGatewayConfig['publicProtocol'],
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...request.headers };
  delete headers.host;
  delete headers.cookie;
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  delete headers['x-forwarded-port'];
  const cookie = forwardWebsiteCookie(request.headers.cookie);
  if (cookie) headers.cookie = cookie;
  headers.host = publicHost;
  headers['x-forwarded-host'] = publicHost;
  headers['x-forwarded-proto'] = publicProtocol;
  headers['x-forwarded-port'] = publicPort(publicHost, publicProtocol);
  return headers;
}

function forwardWebsiteCookie(value: string | undefined): string | undefined {
  const cookies = value
    ?.split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${PREVIEW_AUTH_COOKIE}=`));
  return cookies?.length ? cookies.join('; ') : undefined;
}

function publicPort(publicHost: string, protocol: PreviewGatewayConfig['publicProtocol']): string {
  const match = /:(\d+)$/.exec(publicHost);
  return match?.[1] ?? (protocol === 'https' ? '443' : '80');
}

function handleUpstreamResponse(
  response: http.IncomingMessage,
  reply: {
    raw: {
      writeHead: (status: number, headers: http.OutgoingHttpHeaders) => void;
      end: (chunk?: string | Buffer) => void;
      write: (chunk: Buffer) => boolean;
    };
  },
  publicHost: string,
  config: PreviewGatewayConfig,
  resolve: () => void,
): void {
  const baseHeaders = responseHeaders(response.headers, publicHost, config.publicProtocol);
  const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
  const isHtml = contentType.includes('text/html') && !response.headers['content-encoding'];
  const length = Number(response.headers['content-length'] ?? 0);
  if (!isHtml || (length > MAX_HTML_INJECTION_BYTES && Number.isFinite(length))) {
    reply.raw.writeHead(response.statusCode ?? 502, baseHeaders);
    response.pipe(reply.raw as unknown as NodeJS.WritableStream);
    response.on('end', resolve);
    return;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  let streamed = false;
  response.on('data', (chunk: Buffer) => {
    if (streamed) return;
    chunks.push(chunk);
    total += chunk.byteLength;
    if (total > MAX_HTML_INJECTION_BYTES) {
      streamed = true;
      reply.raw.writeHead(response.statusCode ?? 502, baseHeaders);
      for (const buffered of chunks) reply.raw.write(buffered);
      response.pipe(reply.raw as unknown as NodeJS.WritableStream);
    }
  });
  response.on('end', () => {
    if (streamed) {
      resolve();
      return;
    }
    const original = Buffer.concat(chunks);
    const injected = injectBridge(original, config.webOrigin);
    if (!injected) {
      reply.raw.writeHead(response.statusCode ?? 502, baseHeaders);
      reply.raw.end(original);
      resolve();
      return;
    }
    const headers = { ...baseHeaders };
    delete headers['content-length'];
    delete headers.etag;
    headers['content-length'] = injected.byteLength;
    reply.raw.writeHead(response.statusCode ?? 502, headers);
    reply.raw.end(injected);
    resolve();
  });
}

function responseHeaders(
  headers: http.IncomingHttpHeaders,
  publicHost: string,
  publicProtocol: PreviewGatewayConfig['publicProtocol'],
): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = { ...headers, 'x-robots-tag': 'noindex, nofollow' };
  const setCookies = headers['set-cookie']?.filter((value) => !isReservedSetCookie(value));
  if (setCookies?.length) result['set-cookie'] = setCookies;
  else delete result['set-cookie'];
  if (typeof result.location === 'string')
    result.location = rewriteInternalLocation(result.location, publicHost, publicProtocol);
  return result;
}

function isReservedSetCookie(value: string): boolean {
  return value.trim().toLowerCase().startsWith(`${PREVIEW_AUTH_COOKIE.toLowerCase()}=`);
}

function injectBridge(body: Buffer, parentOrigin: string): Buffer | null {
  const html = body.toString('utf8');
  const normalizedParentOrigin = new URL(parentOrigin).origin;
  const tag = `<script src="/__cloudcrane/preview-bridge.js" data-cloudcrane-parent-origin="${escapeHtmlAttr(normalizedParentOrigin)}"></script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  const bodyStart = /<body(?:\s[^>]*)?>/i.exec(html);
  if (head?.index !== undefined) {
    const end = head.index + head[0].length;
    return Buffer.from(`${html.slice(0, end)}${tag}${html.slice(end)}`, 'utf8');
  }
  if (bodyStart?.index !== undefined) {
    const end = bodyStart.index + bodyStart[0].length;
    return Buffer.from(`${html.slice(0, end)}${tag}${html.slice(end)}`, 'utf8');
  }
  return Buffer.from(`${tag}${html}`, 'utf8');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function rewriteInternalLocation(
  location: string,
  publicHost: string,
  publicProtocol: PreviewGatewayConfig['publicProtocol'],
): string {
  try {
    const parsed = new URL(location);
    if (['127.0.0.1', 'localhost', '0.0.0.0'].includes(parsed.hostname) && parsed.port === '8080') {
      parsed.protocol = `${publicProtocol}:`;
      parsed.hostname = publicHost.split(':')[0]!;
      parsed.port = publicHost.match(/:(\d+)$/)?.[1] ?? '';
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
