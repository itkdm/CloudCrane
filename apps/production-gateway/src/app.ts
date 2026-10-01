import http, { type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { createLogger, type ServiceLogger } from '@cloudcrane/shared';
import type { ProductionGatewayConfig } from './config.js';
import type { ProductionBinding, ProductionBindingStore } from './store.js';

const routableStatuses = new Set(['authorization_required', 'active']);
const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function parseProductionSlug(
  hostHeader: string | undefined,
  hostSuffix: string,
): string | null {
  if (!hostHeader || hostHeader !== hostHeader.trim() || hostHeader.includes(',')) return null;
  let hostname: string;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      return null;
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  const normalizedSuffix = hostSuffix.toLowerCase().replace(/^\.+|\.+$/g, '');
  const suffix = `.${normalizedSuffix}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  if (!/^[a-f0-9]{32}$/.test(slug)) return null;
  return slug;
}

export function buildProductionGatewayServer(
  config: ProductionGatewayConfig,
  store: ProductionBindingStore,
  logger: ServiceLogger = createLogger('production-gateway.http'),
): Server {
  const server = http.createServer((request, response) => {
    const startedAt = Date.now();
    let productionSlug: string | undefined;
    response.on('finish', () => {
      logger.info(
        {
          event: 'production.gateway.request.finished',
          operation: request.method,
          productionSlug,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
          outcome: response.statusCode >= 500 ? 'failed' : 'succeeded',
        },
        'production gateway request completed',
      );
    });
    void routeRequest(request, response)
      .then((result) => {
        productionSlug = result.productionSlug;
      })
      .catch(() => {
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Bad Gateway');
        } else {
          response.destroy();
        }
      });

    async function routeRequest(
      req: http.IncomingMessage,
      res: ServerResponse,
    ): Promise<{ productionSlug?: string }> {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ service: 'production-gateway', status: 'ok' }));
        return {};
      }
      const productionSlug = parseProductionSlug(req.headers.host, config.hostSuffix);
      if (!productionSlug) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return {};
      }

      let binding: ProductionBinding | null;
      try {
        binding = await store.findBySlug(productionSlug);
      } catch {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '5' });
        res.end('Service Unavailable');
        return { productionSlug };
      }
      if (!binding || !routableStatuses.has(binding.status)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return { productionSlug };
      }
      if (!isValidPort(binding.productionPort)) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '5' });
        res.end('Service Unavailable');
        return { productionSlug };
      }
      proxyRequest(req, res, binding, config);
      return { productionSlug };
    }
  });

  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}

function proxyRequest(
  incoming: http.IncomingMessage,
  outgoing: ServerResponse,
  binding: ProductionBinding,
  config: ProductionGatewayConfig,
): void {
  const host = incoming.headers.host ?? '';
  const headers = filteredHeaders(incoming.headers);
  headers.host = host;
  headers['x-forwarded-host'] = host;
  headers['x-forwarded-proto'] = config.publicProtocol;
  const priorForwardedFor = incoming.headers['x-forwarded-for'];
  const remoteAddress = incoming.socket.remoteAddress;
  headers['x-forwarded-for'] = [priorForwardedFor, remoteAddress].filter(Boolean).join(', ');

  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: binding.productionPort!,
      method: incoming.method,
      path: incoming.url || '/',
      headers,
      timeout: config.upstreamTimeoutMs,
    },
    (response) => {
      const responseHeaders = filteredHeaders(response.headers);
      outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
      response.pipe(outgoing);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('production upstream timed out')));
  upstream.on('error', () => {
    if (!outgoing.headersSent) {
      outgoing.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      outgoing.end('Bad Gateway');
    } else {
      outgoing.destroy();
    }
  });
  incoming.on('aborted', () => upstream.destroy());
  outgoing.on('close', () => {
    if (!outgoing.writableEnded) upstream.destroy();
  });
  incoming.pipe(upstream);
}

function filteredHeaders(source: IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const connectionTokens = new Set(
    String(source.connection ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(source)) {
    if (
      !value ||
      hopByHopHeaders.has(name.toLowerCase()) ||
      connectionTokens.has(name.toLowerCase())
    )
      continue;
    headers[name] = value;
  }
  return headers;
}

function isValidPort(port: number | null): port is number {
  return port !== null && Number.isInteger(port) && port > 0 && port <= 65_535;
}
