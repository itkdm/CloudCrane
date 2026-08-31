import path from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(4101),
  webOrigin: z.string().url().default('http://localhost:3000'),
  workspaceGatewayEndpoint: z.string().url().default('http://127.0.0.1:4102'),
  workspaceGatewayClientToken: z.string().min(1).default('dev-client-token'),
  agentDataRoot: z.string().min(1).default('.cloudcrane-data'),
  modelProvider: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  modelAuthPath: z.string().min(1).optional(),
});

export type AgentServiceConfig = z.infer<typeof configSchema> & {
  agentDataRoot: string;
  modelConfigured: boolean;
};

export function loadAgentServiceConfig(env: NodeJS.ProcessEnv = process.env): AgentServiceConfig {
  const parsed = configSchema.parse({
    port: env.AGENT_SERVICE_PORT,
    webOrigin: env.WEB_ORIGIN ?? env.NEXT_PUBLIC_WEB_ORIGIN,
    workspaceGatewayEndpoint: env.WORKSPACE_GATEWAY_ENDPOINT,
    workspaceGatewayClientToken: env.WORKSPACE_GATEWAY_CLIENT_TOKEN,
    agentDataRoot: env.AGENT_DATA_ROOT,
    modelProvider: env.AGENT_MODEL_PROVIDER,
    modelId: env.AGENT_MODEL_ID,
    modelAuthPath: env.AGENT_MODEL_AUTH_PATH,
  });
  return {
    ...parsed,
    agentDataRoot: path.resolve(parsed.agentDataRoot),
    modelConfigured: Boolean(parsed.modelProvider && parsed.modelId),
  };
}
