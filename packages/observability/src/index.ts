import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { loadObservabilityConfig, type ObservabilityConfigOverrides } from './config.js';

export type LogContext = {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  runCorrelationId?: string;
  userId?: string;
  actorType?: 'user' | 'admin' | 'agent' | 'gateway' | 'runner' | 'system';
  websiteId?: string;
  workspaceId?: string;
  sessionId?: string;
  agentRunId?: string;
  runnerId?: string;
  connectionId?: string;
  toolCallId?: string;
  operation?: string;
};

export type EventFields = LogContext & {
  event: string;
  outcome?:
    | 'started'
    | 'succeeded'
    | 'failed'
    | 'blocked'
    | 'aborted'
    | 'timeout'
    | 'cancelled'
    | 'unknown';
  durationMs?: number;
  errorCode?: string;
  errorType?: string;
  statusCode?: number;
  [key: string]: unknown;
};

const contextStorage = new AsyncLocalStorage<LogContext>();

const REDACT_PATHS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'accessToken',
  'refreshToken',
  'idToken',
  'authorization',
  'cookie',
  'prompt',
  'response',
  'toolInput',
  'toolOutput',
  'command',
  'stdout',
  'stderr',
  'env',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.authorization',
  '*.cookie',
  '*.prompt',
  '*.response',
  '*.toolInput',
  '*.toolOutput',
  '*.command',
  '*.stdout',
  '*.stderr',
  '*.env',
  'environment.*',
  '*.environment.*',
  '*.set-cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'payload.prompt',
  'payload.response',
  'payload.toolInput',
  'payload.toolOutput',
];

function meaningful<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function createTraceId(): string {
  return randomHex(16);
}

export function createSpanId(): string {
  return randomHex(8);
}

export function createRequestId(): string {
  return randomUUID();
}

export function parseTraceparent(
  value: string | undefined,
): Pick<LogContext, 'traceId' | 'spanId'> | undefined {
  if (!value) return undefined;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(value.trim());
  if (!match || match[1] === '0'.repeat(32) || match[2] === '0'.repeat(16) || match[3] === '00') {
    return undefined;
  }
  return { traceId: match[1], spanId: match[2] };
}

export function getLogContext(): Readonly<LogContext> {
  return contextStorage.getStore() ?? {};
}

/** Enter a request context for framework callbacks that outlive a hook promise. */
export function enterLogContext(context: LogContext): void {
  // Framework request hooks may run in a reused async resource. Start a fresh
  // context here so fields from a previous request cannot bleed into this one.
  contextStorage.enterWith(meaningful(context));
}

export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  return contextStorage.run({ ...getLogContext(), ...meaningful(context) }, callback);
}

export function bindLogContext<T extends (...args: never[]) => unknown>(
  context: LogContext,
  callback: T,
): T {
  return ((...args: Parameters<T>) => runWithLogContext(context, () => callback(...args))) as T;
}

export function createLogger(service: string, overrides?: ObservabilityConfigOverrides): Logger {
  const config = loadObservabilityConfig(service, process.env, overrides);
  const options: LoggerOptions = {
    level: config.level,
    base: meaningful({
      service: config.service,
      environment: config.environment,
      version: config.version,
      commitSha: config.commitSha,
      region: config.region,
    }),
    mixin: () => {
      const context = getLogContext();
      const spanContext = trace.getActiveSpan()?.spanContext();
      return meaningful({
        ...context,
        // A child Span is the authoritative correlation identity while it is
        // active. The parsed request context remains the fallback when no SDK
        // provider is installed.
        traceId: spanContext?.traceId ?? context.traceId,
        spanId: spanContext?.spanId ?? context.spanId,
      });
    },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  return pino(options, config.stream);
}

export function logEvent(logger: Logger, fields: EventFields, message?: string): void {
  const { event, ...rest } = fields;
  logger.info(meaningful({ event, ...rest }), message ?? event);
}

export function sanitizeText(value: string, maxLength = 240): string {
  const sanitized = value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(token|secret|password|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    )
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[KEY REDACTED]')
    .trim();
  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}…` : sanitized;
}

/** Return only a request pathname; query strings may carry tokens or cookies. */
export function sanitizeRequestPath(value: string | undefined): string {
  if (!value) return '/';
  try {
    return new URL(value, 'http://cloudcrane.invalid').pathname;
  } catch {
    return value.split('?')[0] || '/';
  }
}

export function serializeError(error: unknown): {
  errorType: string;
  errorCode?: string;
  message: string;
} {
  if (error instanceof Error) {
    const errorCode = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return meaningful({
      errorType: error.constructor.name,
      errorCode,
      message: sanitizeText(error.message),
    }) as { errorType: string; errorCode?: string; message: string };
  }
  return { errorType: typeof error, message: sanitizeText(String(error)) };
}

export const OBSERVABILITY_EVENTS = {
  AUTH_LOGIN_SUCCEEDED: 'auth.login.succeeded',
  AUTH_LOGIN_FAILED: 'auth.login.failed',
  AUTH_AUTHORIZATION_DENIED: 'auth.authorization.denied',
  WEBSITE_CREATE_STARTED: 'website.create.started',
  WEBSITE_CREATE_COMPLETED: 'website.create.completed',
  WEBSITE_CREATE_FAILED: 'website.create.failed',
  WORKSPACE_RUNTIME_CREATE_STARTED: 'workspace.runtime.create.started',
  WORKSPACE_RUNTIME_CREATE_COMPLETED: 'workspace.runtime.create.completed',
  WORKSPACE_RUNTIME_RECONCILED: 'workspace.runtime.reconciled',
  WORKSPACE_RUNTIME_FAILED: 'workspace.runtime.failed',
  WORKSPACE_OPERATION_COMPLETED: 'workspace.operation.completed',
  WORKSPACE_OPERATION_FAILED: 'workspace.operation.failed',
  RUNNER_CONNECTED: 'runner.connected',
  RUNNER_DISCONNECTED: 'runner.disconnected',
  RUNNER_HEARTBEAT_TIMEOUT: 'runner.heartbeat.timeout',
  AGENT_SESSION_CREATED: 'agent.session.created',
  AGENT_COMMAND_RECEIVED: 'agent.command.received',
  AGENT_COMMAND_COMPLETED: 'agent.command.completed',
  AGENT_COMMAND_FAILED: 'agent.command.failed',
  HTTP_REQUEST_STARTED: 'http.request.started',
  HTTP_REQUEST_FINISHED: 'http.request.finished',
  HTTP_REQUEST_FAILED: 'http.request.failed',
  WS_CONNECTED: 'ws.connected',
  WS_DISCONNECTED: 'ws.disconnected',
  AGENT_RUN_STARTED: 'agent.run.started',
  AGENT_RUN_FINISHED: 'agent.run.finished',
  AGENT_RUN_COMPLETED: 'agent.run.completed',
  AGENT_RUN_FAILED: 'agent.run.failed',
  AGENT_RUN_ABORTED: 'agent.run.aborted',
  TOOL_CALL_STARTED: 'tool.call.started',
  TOOL_CALL_FINISHED: 'tool.call.finished',
  AGENT_TOOL_STARTED: 'agent.tool.started',
  AGENT_TOOL_COMPLETED: 'agent.tool.completed',
  AGENT_TOOL_FAILED: 'agent.tool.failed',
  AGENT_SKILL_RELOAD_COMPLETED: 'agent.skill.reload.completed',
  AGENT_SKILL_RELOAD_FAILED: 'agent.skill.reload.failed',
  REFERENCE_UPLOAD_COMPLETED: 'reference.upload.completed',
  REFERENCE_MATERIALIZE_COMPLETED: 'reference.materialize.completed',
  REFERENCE_MATERIALIZE_FAILED: 'reference.materialize.failed',
  TEMPLATE_PUBLISH_STARTED: 'template.publish.started',
  TEMPLATE_PUBLISH_BLOCKED: 'template.publish.blocked',
  TEMPLATE_PUBLISH_COMPLETED: 'template.publish.completed',
  TEMPLATE_PUBLISH_FAILED: 'template.publish.failed',
  SNAPSHOT_STAGE_STARTED: 'snapshot.stage.started',
  SNAPSHOT_STAGE_COMPLETED: 'snapshot.stage.completed',
  SNAPSHOT_STAGE_FAILED: 'snapshot.stage.failed',
  SNAPSHOT_INTEGRITY_FAILED: 'snapshot.integrity.failed',
  PBOOT_UPGRADE_STARTED: 'pboot.upgrade.started',
  PBOOT_UPGRADE_BLOCKED: 'pboot.upgrade.blocked',
  PBOOT_UPGRADE_COMPLETED: 'pboot.upgrade.completed',
  PBOOT_UPGRADE_FAILED: 'pboot.upgrade.failed',
  PREVIEW_REQUEST_FAILED: 'preview.request.failed',
  AUDIT_WRITE_FAILED: 'audit.write.failed',
  WORKSPACE_OPERATION_STARTED: 'workspace.operation.started',
  WORKSPACE_OPERATION_FINISHED: 'workspace.operation.finished',
} as const;

export type ObservabilityEvent = (typeof OBSERVABILITY_EVENTS)[keyof typeof OBSERVABILITY_EVENTS];

export { REDACT_PATHS };
export {
  loadObservabilityConfig,
  parseBooleanEnv,
  type ObservabilityConfig,
  type ObservabilityConfigOverrides,
} from './config.js';

export {
  extractTraceContext,
  getActiveTraceContext,
  injectTraceparent,
  loadTracingConfig,
  runWithTraceContext,
  sanitizeSpanAttributes,
  shutdownObservability,
  startObservability,
  withSpan,
  type ObservabilityRuntime,
  type TracingConfig,
} from './tracing.js';
