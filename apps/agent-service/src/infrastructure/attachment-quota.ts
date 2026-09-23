import { and, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  entitlementDefinition,
  entitlementGrant,
  conversationAttachment,
  operation,
  quotaReservation,
  website,
  type PlatformDb,
} from '@cloudcrane/db';
import {
  BILLING_FEATURES,
  decideQuota,
  resolveEntitlements,
  type EntitlementGrant,
} from '@cloudcrane/billing';

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export type AttachmentQuotaReservation = {
  operationId: string;
  reservationId: string;
  attachmentId?: string;
};

export class AttachmentQuotaError extends Error {
  constructor(
    public readonly code: 'QUOTA_EXCEEDED' | 'QUOTA_UNAVAILABLE' | 'IDEMPOTENCY_CONFLICT',
  ) {
    super(
      code === 'QUOTA_EXCEEDED'
        ? 'attachment storage quota exceeded'
        : code === 'IDEMPOTENCY_CONFLICT'
          ? 'attachment upload idempotency key was already used with different parameters'
          : 'attachment quota unavailable',
    );
    this.name = 'AttachmentQuotaError';
  }
}

export class DrizzleAttachmentQuotaService {
  constructor(private readonly db: PlatformDb['db']) {}

  async reserve(input: {
    attachmentId: string;
    userId: string;
    websiteId: string;
    sessionId: string;
    quantity: number;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<AttachmentQuotaReservation> {
    return this.db.transaction(async (tx) => {
      const account = await tx
        .select({ billingAccountId: website.billingAccountId })
        .from(website)
        .where(eq(website.id as never, input.websiteId))
        .limit(1);
      const billingAccountId = account[0]?.billingAccountId;
      if (!billingAccountId) throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      // Serialize admission for an account/feature pair. The reservation table alone
      // cannot lock a row when the account has no previous reservation.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`attachment-quota:${billingAccountId}:${BILLING_FEATURES.storageAccountBytes}`}))`,
      );

      const definition = await tx
        .select({ id: entitlementDefinition.id, valueType: entitlementDefinition.valueType })
        .from(entitlementDefinition)
        .where(eq(entitlementDefinition.key as never, BILLING_FEATURES.storageAccountBytes))
        .limit(1);
      const definitionId = definition[0]?.id;
      if (!definitionId) throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      let recycledOperationId: string | undefined;
      const existingOperation = await tx
        .select({
          id: operation.id,
          status: operation.status,
          requestHash: operation.requestHash,
          resultResourceId: operation.resultResourceId,
        })
        .from(operation)
        .where(
          and(
            eq(operation.billingAccountId as never, billingAccountId),
            eq(operation.type as never, 'attachment.upload'),
            eq(operation.idempotencyKey as never, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existingOperation[0]) {
        if (existingOperation[0].requestHash !== input.requestHash)
          throw new AttachmentQuotaError('IDEMPOTENCY_CONFLICT');
        const existingAttachment = existingOperation[0].resultResourceId
          ? await tx
              .select({ status: conversationAttachment.status })
              .from(conversationAttachment)
              .where(eq(conversationAttachment.id, existingOperation[0].resultResourceId))
              .limit(1)
          : [];
        if (
          existingOperation[0].status === 'running' &&
          existingAttachment[0]?.status === 'uploading'
        )
          throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
        if (
          existingOperation[0].status === 'succeeded' &&
          existingAttachment[0]?.status === 'ready'
        ) {
          const existingReservation = await tx
            .select({ id: quotaReservation.id })
            .from(quotaReservation)
            .where(
              and(
                eq(quotaReservation.operationId as never, existingOperation[0].id),
                eq(quotaReservation.entitlementDefinitionId as never, definitionId),
              ),
            )
            .limit(1);
          if (!existingReservation[0]) throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
          return {
            operationId: existingOperation[0].id,
            reservationId: existingReservation[0].id,
            attachmentId: existingOperation[0].resultResourceId ?? undefined,
          };
        }
        if (
          !['failed', 'expired', 'cancelled', 'retryable', 'succeeded'].includes(
            existingOperation[0].status,
          )
        )
          throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
        recycledOperationId = existingOperation[0].id;
      }
      if (recycledOperationId) {
        await tx
          .update(quotaReservation)
          .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(quotaReservation.operationId as never, recycledOperationId),
              or(
                eq(quotaReservation.status as never, 'reserved'),
                eq(quotaReservation.status as never, 'committed'),
              ),
            ),
          );
      }
      const now = new Date();
      const grants = await tx
        .select({
          id: entitlementGrant.id,
          value: entitlementGrant.value,
          startsAt: entitlementGrant.startsAt,
          endsAt: entitlementGrant.endsAt,
          sourceType: entitlementGrant.sourceType,
          sourceRef: entitlementGrant.sourceRef,
        })
        .from(entitlementGrant)
        .where(
          and(
            eq(entitlementGrant.billingAccountId as never, billingAccountId),
            eq(entitlementGrant.entitlementDefinitionId as never, definitionId),
            eq(entitlementGrant.scope as never, 'account'),
            eq(entitlementGrant.status as never, 'active'),
            isNull(entitlementGrant.revokedAt),
            lte(entitlementGrant.startsAt, now),
            or(isNull(entitlementGrant.endsAt), gt(entitlementGrant.endsAt, now)),
          ),
        )
        .limit(100);
      const entitlements = toStorageEntitlements(grants, billingAccountId);
      const entitlement = resolveEntitlements({
        grants: entitlements,
        scope: 'account',
        scopeId: billingAccountId,
        at: now,
      }).find((item) => item.featureKey === BILLING_FEATURES.storageAccountBytes);
      if (!entitlement || entitlement.valueType !== 'metered')
        throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');

      const committed = await tx
        .select({ total: sql<number>`coalesce(sum(${quotaReservation.quantity}), 0)` })
        .from(quotaReservation)
        .where(
          and(
            eq(quotaReservation.billingAccountId as never, billingAccountId),
            eq(quotaReservation.entitlementDefinitionId as never, definitionId),
            eq(quotaReservation.status as never, 'committed'),
          ),
        );
      const reserved = await tx
        .select({ total: sql<number>`coalesce(sum(${quotaReservation.quantity}), 0)` })
        .from(quotaReservation)
        .where(
          and(
            eq(quotaReservation.billingAccountId as never, billingAccountId),
            eq(quotaReservation.entitlementDefinitionId as never, definitionId),
            eq(quotaReservation.status as never, 'reserved'),
            gt(quotaReservation.expiresAt, new Date()),
          ),
        );
      const current = Number(committed[0]?.total ?? 0) + Number(reserved[0]?.total ?? 0);
      const decision = decideQuota({
        entitlement,
        currentUsage: current,
        requested: input.quantity,
      });
      if (decision.outcome === 'deny') {
        if (decision.code === 'QUOTA_EXCEEDED') throw new AttachmentQuotaError('QUOTA_EXCEEDED');
        throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      }
      if (decision.outcome === 'pending') throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');

      let operationId = recycledOperationId;
      if (operationId) {
        await tx
          .update(operation)
          .set({
            websiteId: input.websiteId,
            status: 'running',
            requestHash: input.requestHash,
            resultResourceId: input.attachmentId,
            metadata: { userId: input.userId, sessionId: input.sessionId },
            errorCode: null,
            errorMessage: null,
            startedAt: new Date(),
            finishedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(operation.id as never, operationId));
      } else {
        const [createdOperation] = await tx
          .insert(operation)
          .values({
            billingAccountId,
            websiteId: input.websiteId,
            type: 'attachment.upload',
            status: 'running',
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            resultResourceId: input.attachmentId,
            metadata: { userId: input.userId, sessionId: input.sessionId },
            startedAt: new Date(),
          })
          .returning({ id: operation.id });
        operationId = createdOperation?.id;
      }
      if (!operationId) throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      const reservationExpiry = new Date(Date.now() + RESERVATION_TTL_MS);
      const [reusedReservation] = recycledOperationId
        ? await tx
            .update(quotaReservation)
            .set({
              quantity: String(input.quantity),
              status: 'reserved',
              expiresAt: reservationExpiry,
              releasedAt: null,
              committedAt: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(quotaReservation.operationId as never, operationId),
                eq(quotaReservation.entitlementDefinitionId as never, definitionId),
              ),
            )
            .returning({ id: quotaReservation.id })
        : [];
      const [createdReservation] = reusedReservation?.id
        ? [reusedReservation]
        : await tx
            .insert(quotaReservation)
            .values({
              billingAccountId,
              operationId,
              entitlementDefinitionId: definitionId,
              quantity: String(input.quantity),
              status: 'reserved',
              expiresAt: reservationExpiry,
            })
            .returning({ id: quotaReservation.id });
      if (!createdReservation?.id) throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      return { operationId, reservationId: createdReservation.id };
    });
  }

  async commitAndFinalize(
    input: AttachmentQuotaReservation & { actualBytes: number; attachmentId: string },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(quotaReservation)
        .set({
          quantity: String(input.actualBytes),
          status: 'committed',
          committedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quotaReservation.id as never, input.reservationId),
            eq(quotaReservation.operationId as never, input.operationId),
            eq(quotaReservation.status as never, 'reserved'),
          ),
        )
        .returning({ id: quotaReservation.id });
      if (updated.length === 0) {
        const existing = await tx
          .select({
            status: quotaReservation.status,
            operationId: quotaReservation.operationId,
            attachmentId: operation.resultResourceId,
            operationStatus: operation.status,
            operationType: operation.type,
          })
          .from(quotaReservation)
          .innerJoin(operation, eq(quotaReservation.operationId, operation.id))
          .where(
            and(
              eq(quotaReservation.id as never, input.reservationId),
              eq(quotaReservation.operationId as never, input.operationId),
              eq(operation.type as never, 'attachment.upload'),
              eq(operation.resultResourceId as never, input.attachmentId),
            ),
          )
          .limit(1);
        if (
          existing[0]?.status !== 'committed' ||
          existing[0].operationId !== input.operationId ||
          existing[0].attachmentId !== input.attachmentId ||
          existing[0].operationType !== 'attachment.upload'
        )
          throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
        if (existing[0].operationStatus !== 'succeeded')
          throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      }

      const finalizedAttachment = await tx
        .update(conversationAttachment)
        .set({ status: 'ready' })
        .where(
          and(
            eq(conversationAttachment.id as never, input.attachmentId),
            eq(conversationAttachment.status as never, 'uploading'),
          ),
        )
        .returning({ id: conversationAttachment.id });
      if (finalizedAttachment.length === 0) {
        const existingAttachment = await tx
          .select({ status: conversationAttachment.status })
          .from(conversationAttachment)
          .where(eq(conversationAttachment.id as never, input.attachmentId))
          .limit(1);
        if (existingAttachment[0]?.status !== 'ready')
          throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      }
      const finalized = await tx
        .update(operation)
        .set({ status: 'succeeded', finishedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(operation.id as never, input.operationId),
            eq(operation.type as never, 'attachment.upload'),
            eq(operation.resultResourceId as never, input.attachmentId),
            eq(operation.status as never, 'running'),
          ),
        )
        .returning({ id: operation.id });
      if (finalized.length === 0) {
        const existingOperation = await tx
          .select({ status: operation.status })
          .from(operation)
          .where(
            and(
              eq(operation.id as never, input.operationId),
              eq(operation.type as never, 'attachment.upload'),
              eq(operation.resultResourceId as never, input.attachmentId),
            ),
          )
          .limit(1);
        if (existingOperation[0]?.status !== 'succeeded')
          throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      }
    });
  }

  async release(input: AttachmentQuotaReservation): Promise<void> {
    await this.db.transaction(async (tx) => {
      const released = await tx
        .update(quotaReservation)
        .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(quotaReservation.id as never, input.reservationId),
            eq(quotaReservation.operationId as never, input.operationId),
            eq(quotaReservation.status as never, 'reserved'),
          ),
        )
        .returning({ id: quotaReservation.id });
      if (released.length > 0)
        await tx
          .update(operation)
          .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(operation.id as never, input.operationId),
              eq(operation.status as never, 'running'),
            ),
          );
    });
  }

  async releaseForAttachment(attachmentId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: quotaReservation.id })
        .from(quotaReservation)
        .innerJoin(operation, eq(quotaReservation.operationId, operation.id))
        .where(
          and(
            eq(operation.type as never, 'attachment.upload'),
            eq(operation.resultResourceId as never, attachmentId),
            or(
              eq(quotaReservation.status as never, 'reserved'),
              eq(quotaReservation.status as never, 'committed'),
            ),
          ),
        );
      for (const row of rows) {
        const released = await tx
          .update(quotaReservation)
          .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(quotaReservation.id as never, row.id),
              or(
                eq(quotaReservation.status as never, 'reserved'),
                eq(quotaReservation.status as never, 'committed'),
              ),
            ),
          )
          .returning({ id: quotaReservation.id, operationId: quotaReservation.operationId });
        if (released[0])
          await tx
            .update(operation)
            .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(operation.id as never, released[0].operationId),
                eq(operation.status as never, 'running'),
              ),
            );
      }
    });
  }

  async cleanupExpiredReservations(now = new Date()): Promise<void> {
    await this.db.transaction(async (tx) => {
      const expired = await tx
        .update(quotaReservation)
        .set({ status: 'released', releasedAt: now, updatedAt: now })
        .where(
          and(
            eq(quotaReservation.status as never, 'reserved'),
            lt(quotaReservation.expiresAt, now),
          ),
        )
        .returning({ operationId: quotaReservation.operationId });
      for (const row of expired)
        await tx
          .update(operation)
          .set({ status: 'failed', finishedAt: now, updatedAt: now })
          .where(
            and(
              eq(operation.id as never, row.operationId),
              eq(operation.status as never, 'running'),
            ),
          );
    });
  }
}

function toStorageEntitlements(
  grants: Array<{
    id: string;
    value: Record<string, unknown>;
    startsAt: Date;
    endsAt: Date | null;
    sourceType: string;
    sourceRef: string | null;
  }>,
  scopeId: string,
): EntitlementGrant[] {
  return grants.flatMap((grant) => {
    const value = grant.value;
    const limitMode = value.limitMode;
    const limit = typeof value.limit === 'number' || value.limit === null ? value.limit : undefined;
    const validLimit =
      limitMode === 'unlimited'
        ? limit === null || (typeof limit === 'number' && limit >= 0)
        : typeof limit === 'number' && limit >= 0;
    if (
      !validLimit ||
      typeof value.unit !== 'string' ||
      !['hard', 'soft', 'unlimited'].includes(String(limitMode))
    )
      return [];
    const normalizedLimit = limit as number | null;
    return [
      {
        id: grant.id,
        featureKey: BILLING_FEATURES.storageAccountBytes,
        scope: 'account' as const,
        scopeId,
        period: { kind: 'lifetime' as const },
        effectiveAt: grant.startsAt,
        expiresAt: grant.endsAt,
        source: { type: grant.sourceType, id: grant.sourceRef ?? grant.id },
        valueType: 'metered' as const,
        value: {
          limit: normalizedLimit,
          unit: value.unit,
          limitMode: limitMode as 'hard' | 'soft' | 'unlimited',
        },
      },
    ];
  });
}
