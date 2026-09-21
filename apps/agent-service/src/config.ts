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
  attachmentStorageDriver: z.enum(['local', 'oss']).default('local'),
  attachmentStorageRoot: z.string().min(1).optional(),
  attachmentMaxBytes: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  attachmentOssBucket: z.string().min(3).optional(),
  attachmentOssRegion: z.string().min(1).optional(),
  attachmentOssEndpoint: z.string().url().optional(),
  attachmentOssInternal: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  attachmentOssAccessKeyId: z.string().min(1).optional(),
  attachmentOssAccessKeySecret: z.string().min(1).optional(),
  attachmentOssStsToken: z.string().min(1).optional(),
  attachmentOssTimeoutMs: z.coerce.number().int().positive().default(60_000),
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
  | 'attachmentOssInternal'
  | 'attachmentOssTimeoutMs'
  | 'templateArtifactRoot'
  | 'templateArtifactMaxBytes'
> & {
  agentDataRoot: string;
  attachmentStorageDriver?: 'local' | 'oss';
  attachmentStorageRoot?: string;
  attachmentMaxBytes?: number;
  attachmentOssBucket?: string;
  attachmentOssRegion?: string;
  attachmentOssEndpoint?: string;
  attachmentOssInternal?: boolean;
  attachmentOssAccessKeyId?: string;
  attachmentOssAccessKeySecret?: string;
  attachmentOssStsToken?: string;
  attachmentOssTimeoutMs?: number;
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
  if (env.ATTACHMENT_STORAGE_DRIVER === 'oss') {
    for (const [name, value] of [
      ['ATTACHMENT_OSS_BUCKET', env.ATTACHMENT_OSS_BUCKET],
      ['ATTACHMENT_OSS_REGION', env.ATTACHMENT_OSS_REGION],
      ['ATTACHMENT_OSS_ACCESS_KEY_ID', env.ATTACHMENT_OSS_ACCESS_KEY_ID],
      ['ATTACHMENT_OSS_ACCESS_KEY_SECRET', env.ATTACHMENT_OSS_ACCESS_KEY_SECRET],
    ] as const) {
      if (!value) throw new Error(`${name} is required when ATTACHMENT_STORAGE_DRIVER=oss`);
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
    attachmentOssBucket: env.ATTACHMENT_OSS_BUCKET,
    attachmentOssRegion: env.ATTACHMENT_OSS_REGION,
    attachmentOssEndpoint: env.ATTACHMENT_OSS_ENDPOINT,
    attachmentOssInternal: env.ATTACHMENT_OSS_INTERNAL,
    attachmentOssAccessKeyId: env.ATTACHMENT_OSS_ACCESS_KEY_ID,
    attachmentOssAccessKeySecret: env.ATTACHMENT_OSS_ACCESS_KEY_SECRET,
    attachmentOssStsToken: env.ATTACHMENT_OSS_STS_TOKEN,
    attachmentOssTimeoutMs: env.ATTACHMENT_OSS_TIMEOUT_MS,
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
