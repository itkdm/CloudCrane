import path from 'node:path';
import { DEFAULT_REFERENCE_UPLOAD_MAX_BYTES } from '@cloudcrane/website-agent';
import { z } from 'zod';
import { TEMPLATE_ARTIFACT_MAX_BYTES } from './infrastructure/template-limits.js';

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(4101),
  webOrigin: z.string().url().default('http://localhost:3000'),
  workspaceGatewayEndpoint: z.string().url().default('http://127.0.0.1:4102'),
  workspaceGatewayClientToken: z.string().min(1).default('dev-client-token'),
  agentDataRoot: z.string().min(1).default('.cloudcrane-data'),
  attachmentStorageDriver: z.enum(['local', 'r2']).default('local'),
  attachmentStorageRoot: z.string().min(1).optional(),
  attachmentMaxBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),
  attachmentR2AccountId: z.string().min(1).optional(),
  attachmentR2Bucket: z.string().min(3).optional(),
  attachmentR2Endpoint: z.string().url().optional(),
  attachmentR2AccessKeyId: z.string().min(1).optional(),
  attachmentR2SecretAccessKey: z.string().min(1).optional(),
  attachmentR2TimeoutMs: z.coerce.number().int().positive().default(120_000),
  modelProvider: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  modelAuthPath: z.string().min(1).optional(),
  previewGatewayOriginTemplate: z.string().url().default('http://{previewSlug}.localhost:4103/'),
  previewSigningSecret: z.string().min(16).default('cloudcrane-preview-dev-secret'),
  previewTokenTtlSeconds: z.coerce.number().int().positive().max(3600).default(600),
  referenceRoot: z.string().min(1).default('.cloudcrane-data/references'),
  templateArtifactRoot: z.string().min(1).default('.cloudcrane-data/templates'),
  internalServiceToken: z.string().min(16).optional(),
  templateArtifactMaxBytes: z.coerce
    .number()
    .int()
    .min(TEMPLATE_ARTIFACT_MAX_BYTES)
    .default(TEMPLATE_ARTIFACT_MAX_BYTES),
  referenceUploadMaxBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_REFERENCE_UPLOAD_MAX_BYTES),
});

export type AgentServiceConfig = Omit<
  z.infer<typeof configSchema>,
  | 'agentDataRoot'
  | 'attachmentStorageDriver'
  | 'attachmentStorageRoot'
  | 'attachmentMaxBytes'
  | 'attachmentR2TimeoutMs'
  | 'templateArtifactRoot'
  | 'templateArtifactMaxBytes'
> & {
  agentDataRoot: string;
  attachmentStorageDriver?: 'local' | 'r2';
  attachmentStorageRoot?: string;
  attachmentMaxBytes?: number;
  attachmentR2AccountId?: string;
  attachmentR2Bucket?: string;
  attachmentR2Endpoint?: string;
  attachmentR2AccessKeyId?: string;
  attachmentR2SecretAccessKey?: string;
  attachmentR2TimeoutMs?: number;
  templateArtifactRoot?: string;
  internalServiceToken?: string;
  templateArtifactMaxBytes?: number;
  modelConfigured: boolean;
};

export function loadAgentServiceConfig(env: NodeJS.ProcessEnv = process.env): AgentServiceConfig {
  if (env.NODE_ENV === 'production' && !env.AGENT_SERVICE_INTERNAL_TOKEN)
    throw new Error('AGENT_SERVICE_INTERNAL_TOKEN is required in production');
  if (env.NODE_ENV === 'production' && !env.WORKSPACE_REFERENCE_ROOT)
    throw new Error('WORKSPACE_REFERENCE_ROOT is required in production');
  if (env.ATTACHMENT_STORAGE_DRIVER === 'r2') {
    for (const [name, value] of [
      ['ATTACHMENT_R2_ACCOUNT_ID', env.ATTACHMENT_R2_ACCOUNT_ID],
      ['ATTACHMENT_R2_BUCKET', env.ATTACHMENT_R2_BUCKET],
      ['ATTACHMENT_R2_ACCESS_KEY_ID', env.ATTACHMENT_R2_ACCESS_KEY_ID],
      ['ATTACHMENT_R2_SECRET_ACCESS_KEY', env.ATTACHMENT_R2_SECRET_ACCESS_KEY],
    ] as const) {
      if (!value) throw new Error(`${name} is required when ATTACHMENT_STORAGE_DRIVER=r2`);
    }
  }
  const parsed = configSchema.parse({
    port: env.AGENT_SERVICE_PORT,
    webOrigin: env.WEB_ORIGIN ?? env.NEXT_PUBLIC_WEB_ORIGIN,
    workspaceGatewayEndpoint: env.WORKSPACE_GATEWAY_ENDPOINT,
    workspaceGatewayClientToken: env.WORKSPACE_GATEWAY_CLIENT_TOKEN,
    agentDataRoot: env.AGENT_DATA_ROOT,
    attachmentStorageDriver: env.ATTACHMENT_STORAGE_DRIVER,
    attachmentStorageRoot: env.ATTACHMENT_STORAGE_ROOT,
    attachmentMaxBytes: env.ATTACHMENT_MAX_BYTES,
    attachmentR2AccountId: env.ATTACHMENT_R2_ACCOUNT_ID,
    attachmentR2Bucket: env.ATTACHMENT_R2_BUCKET,
    attachmentR2Endpoint: env.ATTACHMENT_R2_ENDPOINT,
    attachmentR2AccessKeyId: env.ATTACHMENT_R2_ACCESS_KEY_ID,
    attachmentR2SecretAccessKey: env.ATTACHMENT_R2_SECRET_ACCESS_KEY,
    attachmentR2TimeoutMs: env.ATTACHMENT_R2_TIMEOUT_MS,
    modelProvider: env.AGENT_MODEL_PROVIDER,
    modelId: env.AGENT_MODEL_ID,
    modelAuthPath: env.AGENT_MODEL_AUTH_PATH,
    previewGatewayOriginTemplate: env.PREVIEW_GATEWAY_ORIGIN_TEMPLATE,
    previewSigningSecret: env.PREVIEW_SIGNING_SECRET,
    previewTokenTtlSeconds: env.PREVIEW_TOKEN_TTL_SECONDS,
    referenceRoot: env.WORKSPACE_REFERENCE_ROOT,
    templateArtifactRoot: env.TEMPLATE_ARTIFACT_ROOT,
    internalServiceToken: env.AGENT_SERVICE_INTERNAL_TOKEN,
    templateArtifactMaxBytes: env.TEMPLATE_ARTIFACT_MAX_BYTES,
    referenceUploadMaxBytes: env.REFERENCE_UPLOAD_MAX_BYTES,
  });
  return {
    ...parsed,
    agentDataRoot: path.resolve(parsed.agentDataRoot),
    attachmentStorageRoot: path.resolve(
      parsed.attachmentStorageRoot ?? path.join(parsed.agentDataRoot, 'attachments'),
    ),
    referenceRoot: path.resolve(parsed.referenceRoot),
    templateArtifactRoot: path.resolve(parsed.templateArtifactRoot),
    modelConfigured: Boolean(parsed.modelProvider && parsed.modelId),
  };
}
