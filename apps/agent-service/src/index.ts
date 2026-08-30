import Fastify from 'fastify';
import { createLogger } from '@cloudcrane/shared';

const port = Number(process.env.AGENT_SERVICE_PORT ?? 4101);
const logger = createLogger('agent-service');
const app = Fastify({ loggerInstance: logger });

app.get('/health', async () => ({ service: 'agent-service', status: 'ok' }));

const close = async (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: '0.0.0.0', port });
  logger.info({ port }, 'agent service listening');
} catch (error) {
  logger.error({ error }, 'agent service failed to start');
  process.exit(1);
}
