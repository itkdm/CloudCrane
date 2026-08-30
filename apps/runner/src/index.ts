import { createLogger } from '@cloudcrane/shared';

const logger = createLogger('runner');
logger.info('runner scaffold ready; Docker integration is not implemented');

const close = (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  process.exit(0);
};

process.once('SIGINT', () => close('SIGINT'));
process.once('SIGTERM', () => close('SIGTERM'));
