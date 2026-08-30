import { createPlatformDb } from '@cloudcrane/db';
import { createLogger } from '@cloudcrane/shared';
import { buildGatewayApp } from './app.js';
import { loadGatewayConfig } from './config.js';
import { DrizzleControlPlaneStore } from './infrastructure/db-store.js';

const config = loadGatewayConfig();
const platform = createPlatformDb();
const app = buildGatewayApp(config, new DrizzleControlPlaneStore(platform));
const logger = createLogger('workspace-gateway');

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info({ port: config.port }, 'workspace gateway listening');
} catch (error) {
  logger.error({ error }, 'workspace gateway failed to start');
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
