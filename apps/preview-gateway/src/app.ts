import http from 'node:http';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { verifyPreviewToken } from '@cloudcrane/preview-access';
import {
  createLogger,
  enterLogContext,
  parseTraceparent,
  runWithTraceContext,
  serializeError,
  type ServiceLogger,
  withSpan,
} from '@cloudcrane/shared';
import { performance } from 'node:perf_hooks';
import type { PreviewGatewayConfig } from './config.js';
import { previewBridgeScript } from './bridge-asset.js';
import type { PreviewBinding, PreviewBindingStore } from './store.js';

export const PREVIEW_AUTH_COOKIE = '__cloudcrane_preview';
export const PREVIEW_SHARE_COOKIE = '__cloudcrane_preview_share';
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
  logger: ServiceLogger = createLogger('preview-gateway.http'),
): FastifyInstance {
  const app = Fastify({ bodyLimit: 16 * 1024 * 1024 });
  const requestStarts = new WeakMap<object, number>();
  app.addHook('onRequest', async (request) => {
    requestStarts.set(request, performance.now());
    enterLogContext({
      requestId: request.headers['x-request-id']?.toString() ?? request.id,
      ...parseTraceparent(
        typeof request.headers.traceparent === 'string' ? request.headers.traceparent : undefined,
      ),
    });
  });
  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        event: 'http.request.finished',
        operation: `${request.method} ${request.url.split('?')[0]}`,
        statusCode: reply.statusCode,
        durationMs: Math.round(
          performance.now() - (requestStarts.get(request) ?? performance.now()),
        ),
        outcome: reply.statusCode >= 500 ? 'failed' : 'succeeded',
      },
      'preview gateway request completed',
    );
  });
  app.get('/health', async () => ({ service: 'preview-gateway', status: 'ok' }));
  app.get('/__cloudcrane/preview-bridge.js', async (request, reply) =>
    withPreviewSpan(request, 'preview.bridge', () =>
      (async () => {
        const auth = await authenticate(request, config, store);
        if ('redirect' in auth) {
          reply
            .header('set-cookie', auth.cookie)
            .header('referrer-policy', 'no-referrer')
            .header('cache-control', 'no-store')
            .header('x-robots-tag', 'noindex, nofollow');
          return reply.redirect(auth.redirect, 302);
        }
        if (!auth.binding) return reply.code(auth.status).send({ error: auth.message });
        if (auth.readOnly && !isReadOnlyMethod(request.method))
          return reply.code(403).send({ error: 'shared preview is read-only' });
        if (auth.readOnly) return reply.code(404).send({ error: 'preview bridge is unavailable' });
        const script = await previewBridgeScript();
        reply
          .type('application/javascript; charset=utf-8')
          .header('cache-control', 'no-store, no-cache, must-revalidate')
          .header('x-robots-tag', 'noindex, nofollow');
        return script;
      })(),
    ),
  );
  app.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/*',
    handler: async (request, reply) =>
      withPreviewSpan(request, 'preview.proxy', () =>
        (async () => {
          const auth = await authenticate(request, config, store);
          if ('redirect' in auth) {
            reply
              .header('set-cookie', auth.cookie)
              .header('referrer-policy', 'no-referrer')
              .header('cache-control', 'no-store')
              .header('x-robots-tag', 'noindex, nofollow');
            return reply.redirect(auth.redirect, 302);
          }
          if (!auth.binding) return reply.code(auth.status).send({ error: auth.message });
          if (auth.readOnly) {
            logger.info(
              {
                event: 'preview.share.access',
                websiteId: auth.binding.websiteId,
                shareId: auth.shareId,
                outcome: 'succeeded',
              },
              'shared preview access granted',
            );
            if (!isReadOnlyMethod(request.method) || isUnsafeSharedPath(request.url))
              return reply.code(403).send({ error: 'shared preview is read-only' });
            if (request.headers.upgrade?.toLowerCase() === 'websocket')
              return reply.code(403).send({ error: 'shared preview does not support realtime access' });
          }
          reply.hijack();
          return proxyRequest(
            request,
            reply,
            auth.publicHost,
            auth.previewPort,
            config,
            logger,
            auth.readOnly,
          );
        })(),
      ),
  });
  return app;
}

function withPreviewSpan<T>(
  request: FastifyRequest,
  operation: string,
  callback: () => Promise<T>,
): Promise<T> {
  return runWithTraceContext(
    {
      traceparent:
        typeof request.headers.traceparent === 'string' ? request.headers.traceparent : undefined,
    },
    () => withSpan(operation, { 'cloudcrane.operation': operation }, callback),
  );
}

async function authenticate(
  request: FastifyRequest,
  config: PreviewGatewayConfig,
  store: PreviewBindingStore,
): Promise<
  | {
      binding: PreviewBinding & { previewPort: number };
      publicHost: string;
      upstreamHost: string;
      previewPort: number;
      readOnly: false;
      shareId?: undefined;
    }
  | {
      binding: PreviewBinding & { previewPort: number };
      publicHost: string;
      upstreamHost: string;
      previewPort: number;
      readOnly: true;
      shareId: string;
    }
  | { binding?: undefined; status: 401 | 404; message: string }
  | { binding?: undefined; redirect: string; cookie: string }
> {
  const host = parsePreviewHost(request.headers.host, config.hostSuffixes);
  if (!host) return { status: 404, message: 'preview host is invalid' };
  const binding = (await store.findByPreviewSlug?.(host.value)) ?? null;
  if (!isPreviewReady(binding)) return { status: 404, message: 'preview is unavailable' };

  const queryToken = tokenFromQuery(request);
  const cookieToken = tokenFromCookie(request);
  const claims = verifyPreviewToken(queryToken ?? cookieToken ?? '', config.signingSecret);
  if (claims?.websiteId !== binding.websiteId)
    return authenticateShare(request, host.publicHost, binding, store, config);
  if (!cookieToken && queryToken) {
    const target = new URL(request.url, `http://${host.publicHost}`);
    target.searchParams.delete('token');
    return {
      redirect: target.pathname + target.search,
      cookie: serializePreviewCookie(queryToken, claims.expiresAt, config.cookieSecure),
    };
  }
  return {
    binding,
    publicHost: host.publicHost,
    upstreamHost: host.publicHost,
    previewPort: binding.previewPort,
    readOnly: false,
  };
}

async function authenticateShare(
  request: FastifyRequest,
  publicHost: string,
  binding: PreviewBinding & { previewPort: number },
  store: PreviewBindingStore,
  config: PreviewGatewayConfig,
): Promise<Awaited<ReturnType<typeof authenticate>>> {
  const queryShare = shareFromQuery(request);
  const cookieShare = shareFromCookie(request);
  const shareToken = queryShare ?? cookieShare;
  if (!shareToken || !store.findShareByTokenHash || !store.recordShareAccess)
    return { status: 401, message: 'preview authorization is required' };
  const share = await store.findShareByTokenHash(hashShareToken(shareToken));
  if (!share || share.websiteId !== binding.websiteId) {
    return { status: 401, message: 'preview authorization is required' };
  }
  const accessed = await store.recordShareAccess(share.id);
  if (!accessed) return { status: 401, message: 'preview authorization is required' };
  if (queryShare) {
    const target = new URL(request.url, `http://${publicHost}`);
    target.searchParams.delete('share');
    return {
      redirect: target.pathname + target.search,
      cookie: serializeCookie(
        PREVIEW_SHARE_COOKIE,
        queryShare,
        accessed.expiresAt,
        config.cookieSecure,
      ),
    };
  }
  return {
    binding,
    publicHost,
    upstreamHost: publicHost,
    previewPort: binding.previewPort,
    readOnly: true,
    shareId: share.id,
  };
}

function parsePreviewHost(
  value: string | undefined,
  suffixes: string[],
): { kind: 'slug'; value: string; suffix: string; publicHost: string; publicPort?: number } | null {
  if (!value || value.includes(',')) return null;
  const normalized = value.trim().toLowerCase();
  const match = /^(?<hostname>[^:]+)(?::(?<port>[0-9]{1,5}))?$/.exec(normalized);
  const hostname = match?.groups?.hostname;
  const portValue = match?.groups?.port;
  if (!hostname) return null;
  const slug = /^([a-z0-9]{12})\.(.+)$/i.exec(hostname);
  const route = slug ? { kind: 'slug' as const, value: slug[1]!, suffix: slug[2]! } : null;
  if (!route || !suffixes.some((suffix) => route.suffix === suffix.toLowerCase())) return null;
  const publicPort = portValue ? Number(portValue) : undefined;
  if (publicPort !== undefined && (publicPort < 1 || publicPort > 65535)) return null;
  return {
    kind: route.kind,
    value: route.value,
    suffix: route.suffix,
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

function shareFromQuery(request: FastifyRequest): string | undefined {
  return new URL(request.url, 'http://preview.invalid').searchParams.get('share') ?? undefined;
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

function shareFromCookie(request: FastifyRequest): string | undefined {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PREVIEW_SHARE_COOKIE}=`));
  if (!cookie) return undefined;
  try {
    return decodeURIComponent(cookie.slice(PREVIEW_SHARE_COOKIE.length + 1));
  } catch {
    return undefined;
  }
}

function serializePreviewCookie(token: string, expiresAt: number, secure: boolean): string {
  return serializeCookie(PREVIEW_AUTH_COOKIE, token, new Date(expiresAt * 1000), secure);
}

function serializeCookie(name: string, token: string, expiresAt: Date, secure: boolean): string {
  const sameSite = secure ? 'None' : 'Lax';
  return `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}${secure ? '; Secure' : ''}`;
}

function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isReadOnlyMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function isUnsafeSharedPath(requestUrl: string): boolean {
  const pathname = new URL(requestUrl, 'http://preview.invalid').pathname
    .replace(/\/+/g, '/')
    .toLowerCase();
  return ['/admin', '/api', '/install', '/login', '/config', '/__cloudcrane'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
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
  logger: ServiceLogger,
  readOnly = false,
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
      (response) =>
        void handleUpstreamResponse(response, reply, publicHost, config, resolve, readOnly),
    );
    upstream.on('error', (error) => {
      logger.warn(
        { event: 'preview.request.failed', outcome: 'failed', ...serializeError(error) },
        'preview upstream request failed',
      );
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
  const filtered = cookies?.filter((part) => !part.startsWith(`${PREVIEW_SHARE_COOKIE}=`));
  return filtered?.length ? filtered.join('; ') : undefined;
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
  readOnly: boolean,
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
    const injected = readOnly ? null : injectBridge(original, config.webOrigin);
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
  result['referrer-policy'] = 'no-referrer';
  result['cache-control'] = 'no-store';
  const setCookies = headers['set-cookie']?.filter((value) => !isReservedSetCookie(value));
  if (setCookies?.length) result['set-cookie'] = setCookies;
  else delete result['set-cookie'];
  if (typeof result.location === 'string')
    result.location = rewriteInternalLocation(result.location, publicHost, publicProtocol);
  return result;
}

function isReservedSetCookie(value: string): boolean {
  const cookieName = value.trim().split('=', 1)[0]?.toLowerCase();
  return (
    cookieName === PREVIEW_AUTH_COOKIE.toLowerCase() ||
    cookieName === PREVIEW_SHARE_COOKIE.toLowerCase()
  );
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
  url.searchParams.delete('share');
  return url.pathname + url.search;
}
