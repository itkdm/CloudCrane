import { createLogger, loadTracingConfig, startObservability } from '@cloudcrane/shared';
import { WorkspaceRuntimeService } from './application/workspace-runtime-service.js';
import { ProductionReleaseOperationExecutor } from './application/production-release-operation-executor.js';
import { ProductionReleaseStager } from './application/production-release-stager.js';
import { ProductionRuntimeService } from './application/production-runtime-service.js';
import { loadRunnerConfig } from './config.js';
import { DockerProductionProvider } from './infrastructure/docker/docker-production-provider.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';
import { RunnerGatewayConnection } from './infrastructure/gateway/runner-gateway-connection.js';
import { WorkspaceOperationHandler } from './infrastructure/gateway/workspace-operation-handler.js';

const logger = createLogger('runner');
const observability = startObservability(loadTracingConfig('runner'));
const config = loadRunnerConfig();
const provider = new DockerWorkspaceProvider(config);
const productionProvider = new DockerProductionProvider(config);
export const workspaceRuntimeService = new WorkspaceRuntimeService(provider);
const productionExecutor = new ProductionReleaseOperationExecutor(
  new ProductionReleaseStager(workspaceRuntimeService, config),
  new ProductionRuntimeService(productionProvider),
);
const connection = new RunnerGatewayConnection(
  config,
  new WorkspaceOperationHandler(workspaceRuntimeService, productionExecutor),
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
  void observability.shutdown();
};
process.once('SIGINT', () => close('SIGINT'));
process.once('SIGTERM', () => close('SIGTERM'));
