import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(4103),
  webOrigin: z.string().url().default('http://localhost:3000'),
  publicProtocol: z.enum(['http', 'https']).default('http'),
  cookieSecure: z.boolean().default(false),
  signingSecret: z.string().min(16).default('cloudcrane-preview-dev-secret'),
  hostSuffixes: z.array(z.string().min(1)).default(['localhost', 'preview.platform.com']),
});

export type PreviewGatewayConfig = z.infer<typeof configSchema>;

export function loadPreviewGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): PreviewGatewayConfig {
  return configSchema.parse({
    port: env.PREVIEW_GATEWAY_PORT,
    webOrigin: env.CLOUDCRANE_WEB_ORIGIN ?? env.WEB_ORIGIN,
    publicProtocol: env.PREVIEW_PUBLIC_PROTOCOL,
    cookieSecure:
      env.PREVIEW_COOKIE_SECURE === undefined ? undefined : env.PREVIEW_COOKIE_SECURE === 'true',
    signingSecret: env.PREVIEW_SIGNING_SECRET,
    hostSuffixes: env.PREVIEW_HOST_SUFFIXES
      ? env.PREVIEW_HOST_SUFFIXES.split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined,
  });
}
