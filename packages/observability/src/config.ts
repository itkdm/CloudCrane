import type { DestinationStream } from 'pino';

export type ObservabilityConfig = {
  service: string;
  environment?: string;
  version?: string;
  commitSha?: string;
  region?: string;
  level?: string;
  stream?: DestinationStream;
};

export type ObservabilityConfigOverrides = Partial<ObservabilityConfig>;

const PINO_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

export function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function loadObservabilityConfig(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: ObservabilityConfigOverrides = {},
): ObservabilityConfig {
  const configuredLevel = optional(overrides.level ?? env.LOG_LEVEL) ?? 'info';
  const level = PINO_LEVELS.has(configuredLevel) ? configuredLevel : 'info';

  return {
    service,
    environment: overrides.environment ?? optional(env.CLOUDCRANE_ENV) ?? optional(env.NODE_ENV),
    version: overrides.version ?? optional(env.CLOUDCRANE_VERSION) ?? optional(env.APP_VERSION),
    commitSha:
      overrides.commitSha ?? optional(env.CLOUDCRANE_COMMIT_SHA) ?? optional(env.APP_COMMIT),
    region: overrides.region ?? optional(env.CLOUDCRANE_REGION) ?? optional(env.APP_REGION),
    level,
    stream: overrides.stream,
  };
}
