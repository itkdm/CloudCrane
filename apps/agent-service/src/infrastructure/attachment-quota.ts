import { createHash } from 'node:crypto';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import {
  entitlementDefinition,
  entitlementGrant,
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
};

export class AttachmentQuotaError extends Error {
  constructor(public readonly code: 'QUOTA_EXCEEDED' | 'QUOTA_UNAVAILABLE') {
    super(
      code === 'QUOTA_EXCEEDED'
        ? 'attachment storage quota exceeded'
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

      const requestHash = createHash('sha256')
        .update(JSON.stringify({ attachmentId: input.attachmentId, quantity: input.quantity }))
        .digest('hex');
      const [createdOperation] = await tx
        .insert(operation)
        .values({
          billingAccountId,
          websiteId: input.websiteId,
          type: 'attachment.upload',
          status: 'running',
          idempotencyKey: `attachment:${input.attachmentId}`,
          requestHash,
          resultResourceId: input.attachmentId,
          metadata: { userId: input.userId, sessionId: input.sessionId },
          startedAt: new Date(),
        })
        .returning({ id: operation.id });
      if (!createdOperation?.id) throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      const [createdReservation] = await tx
        .insert(quotaReservation)
        .values({
          billingAccountId,
          operationId: createdOperation.id,
          entitlementDefinitionId: definitionId,
          quantity: String(input.quantity),
          status: 'reserved',
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        })
        .returning({ id: quotaReservation.id });
      if (!createdReservation?.id) throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      return { operationId: createdOperation.id, reservationId: createdReservation.id };
    });
  }

  async commit(input: AttachmentQuotaReservation & { actualBytes: number }): Promise<void> {
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
          .select({ status: quotaReservation.status })
          .from(quotaReservation)
          .where(eq(quotaReservation.id as never, input.reservationId))
          .limit(1);
        if (existing[0]?.status === 'committed') return;
        throw new AttachmentQuotaError('QUOTA_UNAVAILABLE');
      }
      await tx
        .update(operation)
        .set({ status: 'succeeded', finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(operation.id as never, input.operationId));
    });
  }

  async release(input: AttachmentQuotaReservation): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(quotaReservation)
        .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(quotaReservation.id as never, input.reservationId),
            eq(quotaReservation.operationId as never, input.operationId),
            eq(quotaReservation.status as never, 'reserved'),
          ),
        );
      await tx
        .update(operation)
        .set({ status: 'failed', finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(operation.id as never, input.operationId));
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
            eq(quotaReservation.status as never, 'committed'),
          ),
        );
      for (const row of rows)
        await tx
          .update(quotaReservation)
          .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
          .where(eq(quotaReservation.id as never, row.id));
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
