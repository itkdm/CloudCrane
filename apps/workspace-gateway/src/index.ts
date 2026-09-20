import { createPlatformDb } from '@cloudcrane/db';
import {
  createLogger,
  loadTracingConfig,
  serializeError,
  startObservability,
} from '@cloudcrane/shared';
import { buildGatewayApp } from './app.js';
import { loadGatewayConfig } from './config.js';
import { DrizzleControlPlaneStore } from './infrastructure/db-store.js';

const config = loadGatewayConfig();
const platform = createPlatformDb();
const logger = createLogger('workspace-gateway');
const observability = startObservability(loadTracingConfig('workspace-gateway'));
const app = buildGatewayApp(config, new DrizzleControlPlaneStore(platform), undefined, logger);

try {
  await app.listen({ host: '127.0.0.1', port: config.port });
  logger.info({ port: config.port }, 'workspace gateway listening');
} catch (error) {
  logger.error({ ...serializeError(error) }, 'workspace gateway failed to start');
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
