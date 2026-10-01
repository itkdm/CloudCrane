import { createPlatformDb } from '@cloudcrane/db';
import {
  createLogger,
  loadTracingConfig,
  serializeError,
  startObservability,
} from '@cloudcrane/shared';
import { buildProductionGatewayServer } from './app.js';
import { loadProductionGatewayConfig } from './config.js';
import { DrizzleProductionBindingStore } from './store.js';

const config = loadProductionGatewayConfig();
const platform = createPlatformDb();
const logger = createLogger('production-gateway');
const server = buildProductionGatewayServer(
  config,
  new DrizzleProductionBindingStore(platform),
  logger,
);
const observability = startObservability(loadTracingConfig('production-gateway'));

try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info({ port: config.port }, 'production gateway listening');
} catch (error) {
  logger.error({ ...serializeError(error) }, 'production gateway failed to start');
  await platform.pool.end();
  await observability.shutdown();
  process.exitCode = 1;
}

let closing = false;
const close = async (signal: string) => {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutdown requested');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  ).catch((error: unknown) => logger.warn({ ...serializeError(error) }, 'gateway shutdown failed'));
  await platform.pool.end();
  await observability.shutdown();
};
process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));
