import path from 'node:path';
import { createPlatformDb } from '@cloudcrane/db';
import { createAuth, validateAuthRuntimeConfig } from '@cloudcrane/auth';
import {
  createLogger,
  loadTracingConfig,
  serializeError,
  startObservability,
} from '@cloudcrane/shared';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { TemplatePublishingService } from '@cloudcrane/template-publishing';
import { buildAgentServiceApp } from './app.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';
import { loadAgentServiceConfig } from './config.js';
import { DrizzleWebsiteAgentStore } from './infrastructure/website-agent-store.js';
import { DrizzleWebsiteBindingStore } from './infrastructure/website-binding-store.js';
import { ClientPreviewProvider } from './infrastructure/client-preview-provider.js';
import { PreviewClientRegistry } from './infrastructure/preview-client-registry.js';
import { createAttachmentStorage } from '@cloudcrane/attachment-storage';
import { ConversationAttachmentService } from './infrastructure/attachment-service.js';
import { ModelProfileService } from './infrastructure/model-profiles.js';
import { AgentServiceError } from './application/errors.js';

const config = loadAgentServiceConfig();
const logger = createLogger('agent-service');
const observability = startObservability(loadTracingConfig('agent-service'));
const platform = createPlatformDb();
validateAuthRuntimeConfig();
const auth = createAuth(platform.db);
const modelProfiles = new ModelProfileService(
  platform,
  config.modelCredentialEncryptionKey ?? 'cloudcrane-dev-model-credential-key-32',
);
const previewClients = new PreviewClientRegistry();
const templatePublisher = new TemplatePublishingService(
  platform,
  config.workspaceGatewayEndpoint,
  config.workspaceGatewayClientToken,
  config.templateArtifactRoot!,
);
const attachmentStorage = createAttachmentStorage({
  driver: config.attachmentStorageDriver ?? 'local',
  root: config.attachmentStorageRoot ?? path.join(config.agentDataRoot, 'attachments'),
  ...((config.attachmentStorageDriver ?? 'local') === 'oss'
    ? {
        oss: {
          bucket: config.attachmentOssBucket!,
          region: config.attachmentOssRegion!,
          accessKeyId: config.attachmentOssAccessKeyId!,
          accessKeySecret: config.attachmentOssAccessKeySecret!,
          ...(config.attachmentOssStsToken ? { stsToken: config.attachmentOssStsToken } : {}),
          ...(config.attachmentOssEndpoint ? { endpoint: config.attachmentOssEndpoint } : {}),
          internal: config.attachmentOssInternal,
          timeoutMs: config.attachmentOssTimeoutMs,
        },
      }
    : {}),
});
const attachmentService = new ConversationAttachmentService(
  platform.db,
  attachmentStorage,
  config.attachmentStorageDriver ?? 'local',
  config.attachmentMaxBytes ?? 20 * 1024 * 1024,
);

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
      modelResolver: async (modelRuntime: ModelRuntime, userId: string, profileId?: string) => {
        const profile = profileId
          ? await modelProfiles.resolve(userId, profileId)
          : await modelProfiles.resolveDefault(userId);
        if (!profile)
          throw new AgentServiceError(
            'MODEL_NOT_CONFIGURED',
            'configure a model before using the agent',
            409,
          );
        if (profile.providerKind === 'openai-compatible') {
          modelRuntime.registerProvider(profile.providerId, {
            name: profile.displayName,
            baseUrl: profile.baseUrl ?? undefined,
            api: (profile.api ?? 'openai-completions') as Api,
            models: [
              {
                id: profile.modelId,
                name: profile.displayName,
                api: (profile.api ?? 'openai-completions') as Api,
                reasoning: profile.reasoning,
                input: profile.input,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: profile.contextWindow,
                maxTokens: profile.maxTokens,
              },
            ],
          });
        }
        await modelRuntime.setRuntimeApiKey(profile.providerId, profile.apiKey);
        const model = modelRuntime.getModel(profile.providerId, profile.modelId);
        if (!model)
          throw new AgentServiceError(
            'MODEL_UNAVAILABLE',
            'the configured model is not available',
            409,
          );
        return {
          model: model as Model<Api>,
          profileId: profile.id,
          displayName: profile.displayName,
        };
      },
      previewObservationProvider: new ClientPreviewProvider(previewClients),
      referenceUploadMaxBytes: config.referenceUploadMaxBytes,
      templatePublisher: (request) =>
        templatePublisher.publish({
          ...request,
          websiteId: binding.websiteId,
          workspaceId: binding.workspaceId,
        }),
      attachmentResolver: (input) => attachmentService.resolve(input),
    }),
});
const app = buildAgentServiceApp({
  config,
  registry,
  auth,
  db: platform.db,
  modelProfiles,
  attachmentStorage,
  previewClientRegistry: previewClients,
  logger,
});

const close = async (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  await app.close();
  await platform.pool.end();
  await observability.shutdown();
};
process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: '127.0.0.1', port: config.port });
  logger.info({ port: config.port }, 'agent service listening');
} catch (error) {
  logger.error({ ...serializeError(error) }, 'agent service failed to start');
  await platform.pool.end();
  await observability.shutdown();
  process.exitCode = 1;
}
