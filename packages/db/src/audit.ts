import { createHash } from 'node:crypto';
import { and, eq, or } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import { auditEvent } from './schema.js';
import type { PlatformDb } from './client.js';

export const AUDIT_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'CANCELLED',
  'UNKNOWN',
] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export const AUDIT_TERMINAL_STATUSES = [
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'CANCELLED',
  'UNKNOWN',
] as const;
export type AuditTerminalStatus = (typeof AUDIT_TERMINAL_STATUSES)[number];
export type AuditActorType = 'user' | 'agent' | 'gateway' | 'runner' | 'system' | 'admin';
export type AuditEventInsert = Omit<
  InferInsertModel<typeof auditEvent>,
  'metadata' | 'actorType' | 'status' | 'requestSummary' | 'resultSummary'
> & {
  actorType: AuditActorType;
  status: AuditStatus;
  requestSummary?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY =
  /(password|token|secret|cookie|authorization|api[_-]?key|prompt|response|tool|command|stdout|stderr|environment|env|content|body|payload)/i;

// Audit summaries intentionally use a finite vocabulary. New fields must be
// reviewed here rather than silently persisting arbitrary request metadata.
export const AUDIT_SUMMARY_ALLOWED_KEYS = new Set([
  'operation',
  'status',
  'durationMs',
  'nameLength',
  'hasTemplate',
  'provisioned',
  'provided',
  'hasModel',
  'sessionId',
  'websiteId',
  'workspaceId',
  'agentRunId',
  'templateId',
  'referenceId',
  'artifactSize',
  'artifactSha256',
  'sourceWebsiteId',
  'sourcePbootVersion',
  'sourceCoreCommit',
  'dbSchemaVersion',
  'statusCode',
  'runnerId',
  'capability',
  'turnIndex',
  'turnId',
  'denied',
]);

/**
 * Audit summaries are deliberately lossy. They are for indexing an operation,
 * never for storing the request or response body. Keep this function pure so
 * the redaction contract can be regression-tested without a database.
 */
export function sanitizeAuditSummary(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, item]) =>
          AUDIT_SUMMARY_ALLOWED_KEYS.has(key) &&
          !SENSITIVE_KEY.test(key) &&
          ['string', 'number', 'boolean'].includes(typeof item) &&
          (typeof item !== 'number' || Number.isFinite(item)),
      )
      .map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, 240) : item]),
  );
}

export async function insertAuditEvent(platformDb: PlatformDb['db'], input: AuditEventInsert) {
  const finishedAt = AUDIT_TERMINAL_STATUSES.includes(
    input.status as (typeof AUDIT_TERMINAL_STATUSES)[number],
  )
    ? new Date()
    : null;
  const [event] = await platformDb
    .insert(auditEvent)
    .values({
      ...input,
      finishedAt,
      requestSummary: sanitizeAuditSummary(input.requestSummary),
      resultSummary: sanitizeAuditSummary(input.resultSummary),
      metadata: sanitizeAuditSummary(input.metadata),
      ...(input.idempotencyKey
        ? { idempotencyKey: createHash('sha256').update(input.idempotencyKey).digest('hex') }
        : {}),
    })
    .returning({ id: auditEvent.id });
  if (!event) throw new Error('audit event insert returned no row');
  return event.id;
}

export async function finishAuditEvent(
  platformDb: PlatformDb['db'],
  id: string,
  input: {
    status: AuditTerminalStatus;
    durationMs?: number;
    errorCode?: string;
    errorType?: string;
    resultSummary?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  // Audit evidence is append-oriented: this is the sole controlled transition
  // from an in-flight event to a terminal state. There is intentionally no
  // generic update or delete API for audit rows.
  const updates = {
    finishedAt: new Date(),
    status: input.status,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    ...(input.errorType === undefined ? {} : { errorType: input.errorType }),
    ...(input.resultSummary === undefined
      ? {}
      : { resultSummary: sanitizeAuditSummary(input.resultSummary) }),
    ...(input.metadata === undefined ? {} : { metadata: sanitizeAuditSummary(input.metadata) }),
  };
  const [updated] = await platformDb
    .update(auditEvent)
    .set(updates)
    .where(
      and(
        eq(auditEvent.id, id),
        or(eq(auditEvent.status, 'PENDING'), eq(auditEvent.status, 'RUNNING')),
      ),
    )
    .returning({ id: auditEvent.id });
  if (!updated) throw new Error('audit event is missing or already finalized');
}
