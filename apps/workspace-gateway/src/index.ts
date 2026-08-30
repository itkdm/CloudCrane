import Fastify from 'fastify';
import { createLogger } from '@cloudcrane/shared';

const port = Number(process.env.WORKSPACE_GATEWAY_PORT ?? 4102);
const logger = createLogger('workspace-gateway');
const app = Fastify({ loggerInstance: logger });

app.get('/health', async () => ({ service: 'workspace-gateway', status: 'ok' }));

const close = async (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: '0.0.0.0', port });
  logger.info({ port }, 'workspace gateway listening');
} catch (error) {
  logger.error({ error }, 'workspace gateway failed to start');
  process.exit(1);
}
