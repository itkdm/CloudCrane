import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { operation } from '@cloudcrane/db';

export const WEBSITE_CREATE_OPERATION = 'website.create';
export const WEBSITE_DELETE_OPERATION = 'website.delete';
const STALE_OPERATION_AFTER_MS = 10 * 60 * 1000;

export type WebsiteCreateOperationClaim =
  | { kind: 'claimed'; operationId: string }
  | { kind: 'replay'; operationId: string; websiteId: string }
  | { kind: 'pending'; operationId: string }
  | { kind: 'failed'; operationId: string; errorCode: string | null };

export type WebsiteOperationClaim = WebsiteCreateOperationClaim;

export function websiteCreateRequestHash(input: { name: string; templateId?: string }): string {
  return createHash('sha256')
    .update(JSON.stringify({ name: input.name, templateId: input.templateId ?? null }))
    .digest('hex');
}

export function websiteDeleteRequestHash(websiteId: string): string {
  return createHash('sha256').update(JSON.stringify({ websiteId })).digest('hex');
}

export async function claimWebsiteCreateOperation(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  billingAccountId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId?: string;
}): Promise<WebsiteCreateOperationClaim> {
  return claimWebsiteOperation({ ...input, operationType: WEBSITE_CREATE_OPERATION });
}

export async function claimWebsiteDeleteOperation(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  billingAccountId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId?: string;
}): Promise<WebsiteOperationClaim> {
  return claimWebsiteOperation({ ...input, operationType: WEBSITE_DELETE_OPERATION });
}

async function claimWebsiteOperation(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  billingAccountId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId?: string;
  operationType: string;
}): Promise<WebsiteOperationClaim> {
  const existing = await findOperation(input);
  if (existing) return resolveExisting(input, existing);

  let claimed;
  try {
    [claimed] = await input.db
      .insert(operation)
      .values({
        billingAccountId: input.billingAccountId,
        type: input.operationType,
        status: 'pending',
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        requestId: input.requestId,
      })
      .returning({ id: operation.id });
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
  }
  if (!claimed) {
    const concurrent = await findOperation(input);
    if (!concurrent) throw new Error('billing operation disappeared after idempotency conflict');
    return resolveExisting(input, concurrent);
  }

  await markRunning(input.db, claimed.id);
  return { kind: 'claimed', operationId: claimed.id };
}

export async function finishWebsiteCreateOperation(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  operationId: string;
  status: 'succeeded' | 'failed';
  websiteId?: string;
  errorCode?: string;
  errorMessage?: string;
}): Promise<void> {
  return finishWebsiteOperation(input);
}

export async function finishWebsiteDeleteOperation(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  operationId: string;
  status: 'succeeded' | 'failed';
  websiteId?: string;
  errorCode?: string;
  errorMessage?: string;
}): Promise<void> {
  return finishWebsiteOperation(input);
}

async function finishWebsiteOperation(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  operationId: string;
  status: 'succeeded' | 'failed';
  websiteId?: string;
  errorCode?: string;
  errorMessage?: string;
}): Promise<void> {
  await input.db
    .update(operation)
    .set({
      status: input.status,
      ...(input.websiteId ? { websiteId: input.websiteId, resultResourceId: input.websiteId } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(operation.id as never, input.operationId));
}

async function findOperation(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  billingAccountId: string;
  idempotencyKey: string;
  operationType: string;
}) {
  const rows = await input.db
    .select({
      id: operation.id,
      status: operation.status,
      requestHash: operation.requestHash,
      resultResourceId: operation.resultResourceId,
      errorCode: operation.errorCode,
      updatedAt: operation.updatedAt,
    })
    .from(operation)
    .where(
      and(
        eq(operation.billingAccountId as never, input.billingAccountId),
        eq(operation.type as never, input.operationType),
        eq(operation.idempotencyKey as never, input.idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function resolveExisting(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: { db: any; requestHash: string },
  existing: {
    id: string;
    status: string;
    requestHash: string | null;
    resultResourceId: string | null;
    errorCode: string | null;
    updatedAt: Date;
  },
): Promise<WebsiteCreateOperationClaim> {
  if (existing.requestHash !== input.requestHash)
    throw new WebsiteOperationIdempotencyError('IDEMPOTENCY_KEY_REUSED');

  if (existing.status === 'succeeded' && existing.resultResourceId)
    return { kind: 'replay', operationId: existing.id, websiteId: existing.resultResourceId };
  if (existing.status === 'failed')
    return { kind: 'failed', operationId: existing.id, errorCode: existing.errorCode };
  if (
    (existing.status === 'pending' || existing.status === 'running') &&
    existing.updatedAt < new Date(Date.now() - STALE_OPERATION_AFTER_MS)
  ) {
    const updated = await input.db
      .update(operation)
      .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(operation.id as never, existing.id),
          lt(operation.updatedAt as never, new Date(Date.now() - STALE_OPERATION_AFTER_MS)),
          eq(operation.status as never, existing.status),
        ),
      )
      .returning({ id: operation.id });
    if (updated.length > 0) return { kind: 'claimed', operationId: existing.id };
  }
  return { kind: 'pending', operationId: existing.id };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markRunning(db: any, operationId: string): Promise<void> {
  await db
    .update(operation)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(operation.id as never, operationId));
}

export class WebsiteOperationIdempotencyError extends Error {
  constructor(public readonly code: 'IDEMPOTENCY_KEY_REUSED') {
    super('Idempotency-Key was already used with different website creation parameters');
    this.name = 'WebsiteOperationIdempotencyError';
  }
}

export { WebsiteOperationIdempotencyError as WebsiteCreateIdempotencyError };
