import { createPlatformDb } from '@cloudcrane/db';
import { createLogger } from '@cloudcrane/shared';
import { buildPreviewGatewayApp } from './app.js';
import { loadPreviewGatewayConfig } from './config.js';
import { DrizzlePreviewBindingStore } from './store.js';

const config = loadPreviewGatewayConfig();
const platform = createPlatformDb();
const app = buildPreviewGatewayApp(config, new DrizzlePreviewBindingStore(platform));
const logger = createLogger('preview-gateway');

try {
  await app.listen({ host: '127.0.0.1', port: config.port });
  logger.info({ port: config.port }, 'preview gateway listening');
} catch (error) {
  logger.error({ error }, 'preview gateway failed to start');
  await platform.pool.end();
  process.exitCode = 1;
}

const close = async (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  await app.close();
  await platform.pool.end();
};
process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));
