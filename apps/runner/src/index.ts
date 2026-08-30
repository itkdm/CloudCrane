import { createLogger } from '@cloudcrane/shared';
import { WorkspaceRuntimeService } from './application/workspace-runtime-service.js';
import { loadRunnerConfig } from './config.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';

const logger = createLogger('runner');
const config = loadRunnerConfig();
const provider = new DockerWorkspaceProvider(config);
export const workspaceRuntimeService = new WorkspaceRuntimeService(provider);
logger.info({ runnerId: config.runnerId, operation: 'runner.start', status: 'ok' }, 'runner ready');

const close = (signal: string) => {
  logger.info({ signal, operation: 'runner.stop', status: 'ok' }, 'shutdown requested');
  process.exit(0);
};

process.once('SIGINT', () => close('SIGINT'));
process.once('SIGTERM', () => close('SIGTERM'));
