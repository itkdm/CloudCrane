import { createLogger } from '@cloudcrane/shared';
import { WorkspaceRuntimeService } from './application/workspace-runtime-service.js';
import { loadRunnerConfig } from './config.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';
import { RunnerGatewayConnection } from './infrastructure/gateway/runner-gateway-connection.js';
import { WorkspaceOperationHandler } from './infrastructure/gateway/workspace-operation-handler.js';

const logger = createLogger('runner');
const config = loadRunnerConfig();
const provider = new DockerWorkspaceProvider(config);
export const workspaceRuntimeService = new WorkspaceRuntimeService(provider);
const connection = new RunnerGatewayConnection(
  config,
  new WorkspaceOperationHandler(workspaceRuntimeService),
);
connection.start();
logger.info(
  {
    runnerId: config.runnerId,
    connected: Boolean(config.gatewayUrl),
    operation: 'runner.start',
    status: 'ok',
  },
  'runner ready',
);

const close = (signal: string) => {
  logger.info({ signal, operation: 'runner.stop', status: 'ok' }, 'shutdown requested');
  connection.stop();
};
process.once('SIGINT', () => close('SIGINT'));
process.once('SIGTERM', () => close('SIGTERM'));
