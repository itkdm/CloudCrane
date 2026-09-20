import { createPlatformDb } from '@cloudcrane/db';
import {
  createLogger,
  loadTracingConfig,
  serializeError,
  startObservability,
} from '@cloudcrane/shared';
import { buildPreviewGatewayApp } from './app.js';
import { loadPreviewGatewayConfig } from './config.js';
import { DrizzlePreviewBindingStore } from './store.js';

const config = loadPreviewGatewayConfig();
const platform = createPlatformDb();
const logger = createLogger('preview-gateway');
const app = buildPreviewGatewayApp(config, new DrizzlePreviewBindingStore(platform), logger);
const observability = startObservability(loadTracingConfig('preview-gateway'));

try {
  await app.listen({ host: '127.0.0.1', port: config.port });
  logger.info({ port: config.port }, 'preview gateway listening');
} catch (error) {
  logger.error({ ...serializeError(error) }, 'preview gateway failed to start');
  await platform.pool.end();
  await observability.shutdown();
  process.exitCode = 1;
}

const close = async (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  await app.close();
  await platform.pool.end();
  await observability.shutdown();
};
process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));
