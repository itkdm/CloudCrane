import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(4102),
  clientToken: z.string().min(1),
  runnerToken: z.string().min(1),
  heartbeatIntervalMs: z.coerce.number().int().positive().default(10_000),
  requestTimeoutMs: z.coerce.number().int().positive().max(300_000).default(120_000),
  offlineTimeoutMs: z.coerce.number().int().positive().default(30_000),
});

export type GatewayConfig = z.infer<typeof configSchema>;

export function loadGatewayConfig(env = process.env): GatewayConfig {
  return configSchema.parse({
    port: env.WORKSPACE_GATEWAY_PORT,
    clientToken: env.WORKSPACE_GATEWAY_CLIENT_TOKEN ?? 'dev-client-token',
    runnerToken: env.RUNNER_AUTH_TOKEN ?? 'dev-runner-token',
    heartbeatIntervalMs: env.WORKSPACE_GATEWAY_HEARTBEAT_INTERVAL_MS,
    requestTimeoutMs: env.WORKSPACE_GATEWAY_REQUEST_TIMEOUT_MS,
    offlineTimeoutMs: env.WORKSPACE_GATEWAY_OFFLINE_TIMEOUT_MS,
  });
}
