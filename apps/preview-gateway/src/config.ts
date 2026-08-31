import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(4103),
  signingSecret: z.string().min(16).default('cloudcrane-preview-dev-secret'),
  hostSuffixes: z.array(z.string().min(1)).default(['localhost', 'preview.platform.com']),
});

export type PreviewGatewayConfig = z.infer<typeof configSchema>;

export function loadPreviewGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): PreviewGatewayConfig {
  return configSchema.parse({
    port: env.PREVIEW_GATEWAY_PORT,
    signingSecret: env.PREVIEW_SIGNING_SECRET,
    hostSuffixes: env.PREVIEW_HOST_SUFFIXES
      ? env.PREVIEW_HOST_SUFFIXES.split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined,
  });
}
