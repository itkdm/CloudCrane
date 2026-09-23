import { describe, expect, it } from 'vitest';
import {
  QuotaReservationConflictError,
  reserveQuota,
  type PersistedQuotaReservation,
  type QuotaReservationStore,
} from './quota.js';
import type { ResolvedEntitlement } from './entitlements.js';

const entitlement: ResolvedEntitlement = {
  featureKey: 'production.website_count',
  scope: 'account',
  scopeId: 'account-1',
  valueType: 'metered',
  value: { limit: 2, unit: 'website', limitMode: 'hard' },
  limitMode: 'hard',
  period: { kind: 'lifetime' },
  effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
  priority: 0,
  stacking: 'replace',
  contributions: [],
  explanation: 'test',
};

function store(): QuotaReservationStore & { reservations: PersistedQuotaReservation[] } {
  const reservations: PersistedQuotaReservation[] = [];
  return {
    reservations,
    withTransaction: async (callback) => callback(undefined),
    findReservation: async (_transaction, identity) =>
      reservations.find(
        (reservation) =>
          reservation.operationId === identity.operationId &&
          reservation.featureKey === identity.featureKey &&
          reservation.scope === identity.scope &&
          reservation.scopeId === identity.scopeId,
      ) ?? null,
    getCurrentUsage: async () => 0,
    insertReservation: async (_transaction, identity) => {
      const persisted = {
        id: `reservation-${reservations.length + 1}`,
        ...identity,
        status: 'pending' as const,
      };
      reservations.push(persisted);
      return persisted;
    },
  };
}

const identity = {
  operationId: 'operation-1',
  idempotencyKey: 'request-1',
  featureKey: 'production.website_count',
  scope: 'account' as const,
  scopeId: 'account-1',
  quantity: 1,
  expiresAt: new Date('2026-09-23T00:10:00.000Z'),
};

describe('reserveQuota', () => {
  it('persists one reservation and reuses it for a retry', async () => {
    const quotaStore = store();
    const first = await reserveQuota({ store: quotaStore, entitlement, identity });
    const second = await reserveQuota({ store: quotaStore, entitlement, identity });

    expect(first.decision.code).toBe('QUOTA_RESERVED');
    expect(first.reservation?.id).toBe('reservation-1');
    expect(second.decision.code).toBe('RESERVATION_PENDING');
    expect(second.reservation?.id).toBe('reservation-1');
    expect(quotaStore.reservations).toHaveLength(1);
  });

  it('rejects reusing an operation reservation with different request data', async () => {
    const quotaStore = store();
    await reserveQuota({ store: quotaStore, entitlement, identity });

    await expect(
      reserveQuota({
        store: quotaStore,
        entitlement,
        identity: { ...identity, idempotencyKey: 'request-2' },
      }),
    ).rejects.toBeInstanceOf(QuotaReservationConflictError);
  });
});
