import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().positive().max(65_535).default(4104),
  hostSuffix: z
    .string()
    .min(1)
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/),
  publicProtocol: z.enum(['http', 'https']).default('https'),
  upstreamTimeoutMs: z.coerce.number().int().positive().max(600_000).default(180_000),
});

export type ProductionGatewayConfig = z.infer<typeof configSchema>;

export function loadProductionGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionGatewayConfig {
  const hostSuffix = env.PRODUCTION_HOST_SUFFIX?.trim()
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();
  if (!hostSuffix) throw new Error('PRODUCTION_HOST_SUFFIX is required');
  return configSchema.parse({
    port: env.PRODUCTION_GATEWAY_PORT,
    hostSuffix,
    publicProtocol: env.PRODUCTION_PUBLIC_PROTOCOL,
    upstreamTimeoutMs: env.PRODUCTION_UPSTREAM_TIMEOUT_MS,
  });
}
