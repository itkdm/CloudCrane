import path from 'node:path';
import { createPlatformDb } from '@cloudcrane/db';
import { createLogger } from '@cloudcrane/shared';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { buildAgentServiceApp } from './app.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';
import { loadAgentServiceConfig } from './config.js';
import { DrizzleWebsiteAgentStore } from './infrastructure/website-agent-store.js';
import { DrizzleWebsiteBindingStore } from './infrastructure/website-binding-store.js';
import { ClientPreviewProvider } from './infrastructure/client-preview-provider.js';
import { PreviewClientRegistry } from './infrastructure/preview-client-registry.js';

const config = loadAgentServiceConfig();
const logger = createLogger('agent-service');
const platform = createPlatformDb();
const modelRuntime = await ModelRuntime.create({
  authPath: config.modelAuthPath ?? path.join(config.agentDataRoot, 'model-auth.json'),
  modelsPath: null,
  allowModelNetwork: false,
  refreshOnCreate: false,
});
const model = config.modelConfigured
  ? modelRuntime.getModel(config.modelProvider!, config.modelId!)
  : undefined;
if (config.modelConfigured && !model) throw new Error('configured agent model is not available');
const previewClients = new PreviewClientRegistry();

const registry = new WebsiteRuntimeRegistry({
  bindingStore: new DrizzleWebsiteBindingStore(platform),
  createRuntime: (binding) =>
    new WebsiteAgentRuntime({
      websiteId: binding.websiteId,
      workspaceId: binding.workspaceId,
      workspaceGatewayEndpoint: config.workspaceGatewayEndpoint,
      workspaceClientToken: config.workspaceGatewayClientToken,
      agentDataRoot: config.agentDataRoot,
      store: new DrizzleWebsiteAgentStore(platform),
      modelRuntime,
      model,
      previewObservationProvider: new ClientPreviewProvider(previewClients),
      referenceUploadMaxBytes: config.referenceUploadMaxBytes,
    }),
});
const app = buildAgentServiceApp({ config, registry, previewClientRegistry: previewClients });

const close = async (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  await app.close();
  await platform.pool.end();
};
process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: '127.0.0.1', port: config.port });
  logger.info({ port: config.port }, 'agent service listening');
} catch (error) {
  logger.error({ error }, 'agent service failed to start');
  await platform.pool.end();
  process.exitCode = 1;
}
