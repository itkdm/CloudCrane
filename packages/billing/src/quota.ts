import {
  decideQuota,
  type EntitlementScope,
  type QuotaDecision,
  type ResolvedEntitlement,
  type ReservationState,
} from './entitlements.js';

export type ReservationIdentity = {
  operationId: string;
  idempotencyKey: string;
  featureKey: string;
  scope: EntitlementScope;
  scopeId: string;
  quantity: number;
  expiresAt: Date;
};

export type PersistedQuotaReservation = ReservationIdentity & {
  id: string;
  status: ReservationState['status'];
};

export type QuotaReservationStore<TTransaction = unknown> = {
  withTransaction<T>(callback: (transaction: TTransaction) => Promise<T>): Promise<T>;
  findReservation(
    transaction: TTransaction,
    identity: Pick<ReservationIdentity, 'operationId' | 'featureKey' | 'scope' | 'scopeId'>,
  ): Promise<PersistedQuotaReservation | null>;
  getCurrentUsage(
    transaction: TTransaction,
    input: Pick<ReservationIdentity, 'featureKey' | 'scope' | 'scopeId'>,
  ): Promise<number | null>;
  insertReservation(
    transaction: TTransaction,
    identity: ReservationIdentity,
  ): Promise<PersistedQuotaReservation>;
};

export type ReserveQuotaInput<TTransaction = unknown> = {
  store: QuotaReservationStore<TTransaction>;
  entitlement: ResolvedEntitlement;
  identity: ReservationIdentity;
};

export type ReserveQuotaResult = {
  decision: QuotaDecision;
  reservation: PersistedQuotaReservation | null;
};

export class QuotaReservationConflictError extends Error {
  constructor() {
    super('The existing quota reservation does not match the requested operation');
    this.name = 'QuotaReservationConflictError';
  }
}

/**
 * Performs the decision and persistence in one repository transaction.
 * The repository must lock the usage/reservation rows while reading usage;
 * this function intentionally does not offer a non-transactional escape hatch.
 */
export async function reserveQuota<TTransaction = unknown>(
  input: ReserveQuotaInput<TTransaction>,
): Promise<ReserveQuotaResult> {
  return input.store.withTransaction(async (transaction) => {
    const existing = await input.store.findReservation(transaction, {
      operationId: input.identity.operationId,
      featureKey: input.identity.featureKey,
      scope: input.identity.scope,
      scopeId: input.identity.scopeId,
    });
    if (
      existing &&
      (existing.idempotencyKey !== input.identity.idempotencyKey ||
        existing.quantity !== input.identity.quantity)
    )
      throw new QuotaReservationConflictError();
    const currentUsage = await input.store.getCurrentUsage(transaction, {
      featureKey: input.identity.featureKey,
      scope: input.identity.scope,
      scopeId: input.identity.scopeId,
    });
    const decision = decideQuota({
      entitlement: input.entitlement,
      requested: input.identity.quantity,
      ...(currentUsage === null ? {} : { currentUsage }),
      existingReservation: existing
        ? {
            idempotencyKey: existing.idempotencyKey,
            status: existing.status,
            quantity: existing.quantity,
          }
        : undefined,
    });

    if (decision.outcome !== 'reserve' || !decision.reservation)
      return { decision, reservation: existing };

    if (existing) return { decision, reservation: existing };

    const reservation = await input.store.insertReservation(transaction, input.identity);
    return { decision, reservation };
  });
}
