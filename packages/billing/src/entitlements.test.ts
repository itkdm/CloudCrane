import { describe, expect, it } from 'vitest';
import {
  decideQuota,
  EntitlementResolutionError,
  resolveEntitlements,
  type EntitlementGrant,
  type ResolvedEntitlement,
} from './entitlements.js';

const now = new Date('2026-09-23T00:00:00.000Z');

function grant(
  overrides: Partial<EntitlementGrant> & Pick<EntitlementGrant, 'valueType' | 'value'>,
): EntitlementGrant {
  return {
    id: 'plan-free',
    featureKey: 'production.website_count',
    scope: 'account',
    scopeId: 'account-1',
    period: {
      kind: 'billing_period',
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    },
    effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
    source: { type: 'plan', id: 'free-v1' },
    ...overrides,
  } as EntitlementGrant;
}

function meteredEntitlement(overrides: Partial<ResolvedEntitlement> = {}): ResolvedEntitlement {
  return {
    featureKey: 'storage.bytes',
    scope: 'account',
    scopeId: 'account-1',
    valueType: 'metered',
    value: { limit: 100, unit: 'bytes', limitMode: 'hard' },
    limitMode: 'hard',
    period: {
      kind: 'billing_period',
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    },
    effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
    expiresAt: null,
    priority: 0,
    stacking: 'replace',
    contributions: [],
    explanation: 'test entitlement',
    ...overrides,
  };
}

describe('resolveEntitlements', () => {
  it('filters by scope and effective period', () => {
    const result = resolveEntitlements({
      scope: 'account',
      scopeId: 'account-1',
      at: now,
      grants: [
        grant({ valueType: 'boolean', value: true, featureKey: 'production.enabled' }),
        grant({
          valueType: 'boolean',
          value: true,
          featureKey: 'workspace.enabled',
          scopeId: 'account-2',
        }),
        grant({
          valueType: 'boolean',
          value: true,
          featureKey: 'expired.feature',
          expiresAt: new Date('2026-09-22T00:00:00.000Z'),
        }),
      ],
    });

    expect(result.map((item) => item.featureKey)).toEqual(['production.enabled']);
    expect(result[0]?.contributions[0]?.source).toEqual({ type: 'plan', id: 'free-v1' });
  });

  it('uses a higher-priority replacement grant and exposes its provenance', () => {
    const result = resolveEntitlements({
      scope: 'account',
      scopeId: 'account-1',
      at: now,
      grants: [
        grant({ valueType: 'boolean', value: true, featureKey: 'production.enabled', priority: 0 }),
        grant({
          id: 'admin-revocation',
          valueType: 'boolean',
          value: false,
          featureKey: 'production.enabled',
          priority: 100,
          source: { type: 'admin', id: 'case-1' },
        }),
      ],
    });

    expect(result[0]?.value).toBe(false);
    expect(result[0]?.priority).toBe(100);
    expect(result[0]?.explanation).toContain('admin-revocation');
    expect(result[0]?.contributions).toHaveLength(2);
  });

  it('uses the selected replacement grant period instead of extending it with lower-priority grants', () => {
    const result = resolveEntitlements({
      scope: 'account',
      scopeId: 'account-1',
      at: now,
      grants: [
        grant({
          id: 'temporary-override',
          valueType: 'boolean',
          value: true,
          priority: 100,
          expiresAt: new Date('2026-09-30T00:00:00.000Z'),
        }),
        grant({
          id: 'long-lived-plan',
          valueType: 'boolean',
          value: false,
          priority: 0,
          expiresAt: null,
        }),
      ],
    });

    expect(result[0]?.expiresAt).toEqual(new Date('2026-09-30T00:00:00.000Z'));
  });

  it('rejects incompatible metered grant periods and non-metered stacking', () => {
    expect(() =>
      resolveEntitlements({
        scope: 'account',
        scopeId: 'account-1',
        at: now,
        grants: [
          grant({
            valueType: 'metered',
            value: { limit: 10, unit: 'bytes', limitMode: 'hard' },
            stacking: 'add',
          }),
          grant({
            valueType: 'metered',
            value: { limit: 10, unit: 'bytes', limitMode: 'hard' },
            stacking: 'add',
            period: { kind: 'rolling_window', durationMs: 86_400_000 },
          }),
        ],
      }),
    ).toThrowError(
      new EntitlementResolutionError('ENTITLEMENT_PERIOD_CONFLICT', 'production.website_count'),
    );

    expect(() =>
      resolveEntitlements({
        scope: 'account',
        scopeId: 'account-1',
        at: now,
        grants: [grant({ valueType: 'boolean', value: true, stacking: 'add' })],
      }),
    ).toThrowError(
      new EntitlementResolutionError('ENTITLEMENT_STACKING_CONFLICT', 'production.website_count'),
    );
  });

  it('adds metered grants and lets an unlimited grant dominate', () => {
    const result = resolveEntitlements({
      scope: 'account',
      scopeId: 'account-1',
      at: now,
      grants: [
        grant({
          id: 'plan-storage',
          valueType: 'metered',
          value: { limit: 100, unit: 'bytes', limitMode: 'hard' },
          featureKey: 'storage.bytes',
          stacking: 'add',
        }),
        grant({
          id: 'bonus-storage',
          valueType: 'metered',
          value: { limit: 50, unit: 'bytes', limitMode: 'soft' },
          featureKey: 'storage.bytes',
          stacking: 'add',
          source: { type: 'grant', id: 'bonus-1' },
        }),
        grant({
          id: 'admin-unlimited',
          valueType: 'metered',
          value: { limit: null, unit: 'bytes', limitMode: 'unlimited' },
          featureKey: 'storage.bytes',
          stacking: 'max',
        }),
      ],
    });

    expect(result[0]?.value).toEqual({ limit: null, unit: 'bytes', limitMode: 'unlimited' });
    expect(result[0]?.contributions.map((item) => item.grantId)).toEqual([
      'admin-unlimited',
      'bonus-storage',
      'plan-storage',
    ]);
  });

  it('rejects incompatible value types and meter units', () => {
    expect(() =>
      resolveEntitlements({
        scope: 'account',
        scopeId: 'account-1',
        at: now,
        grants: [
          grant({ valueType: 'boolean', value: true, featureKey: 'mixed' }),
          grant({ valueType: 'static', value: { enabled: true }, featureKey: 'mixed' }),
        ],
      }),
    ).toThrowError(new EntitlementResolutionError('ENTITLEMENT_TYPE_CONFLICT', 'mixed'));

    expect(() =>
      resolveEntitlements({
        scope: 'account',
        scopeId: 'account-1',
        at: now,
        grants: [
          grant({
            valueType: 'metered',
            value: { limit: 1, unit: 'bytes', limitMode: 'hard' },
            featureKey: 'mixed',
            stacking: 'add',
          }),
          grant({
            valueType: 'metered',
            value: { limit: 1, unit: 'seconds', limitMode: 'hard' },
            featureKey: 'mixed',
            stacking: 'add',
          }),
        ],
      }),
    ).toThrowError(new EntitlementResolutionError('ENTITLEMENT_UNIT_CONFLICT', 'mixed'));
  });
});

describe('decideQuota', () => {
  it('allows enabled features and denies disabled features with stable codes', () => {
    const enabled = resolveEntitlements({
      scope: 'account',
      scopeId: 'account-1',
      at: now,
      grants: [grant({ valueType: 'boolean', value: true, featureKey: 'production.enabled' })],
    })[0];
    const disabled = resolveEntitlements({
      scope: 'account',
      scopeId: 'account-1',
      at: now,
      grants: [grant({ valueType: 'boolean', value: false, featureKey: 'production.enabled' })],
    })[0];

    expect(decideQuota({ entitlement: enabled, requested: 1 }).outcome).toBe('allow');
    expect(decideQuota({ entitlement: enabled, requested: 1 }).code).toBe('ALLOWED');
    expect(decideQuota({ entitlement: disabled, requested: 1 })).toMatchObject({
      outcome: 'deny',
      code: 'FEATURE_DISABLED',
    });
  });

  it('returns reserve for an available hard quota and deny when it would exceed it', () => {
    const entitlement = meteredEntitlement();

    expect(decideQuota({ entitlement, currentUsage: 60, requested: 30 })).toMatchObject({
      outcome: 'reserve',
      code: 'QUOTA_RESERVED',
      remaining: 10,
      reservation: { required: true, quantity: 30, usageAfter: 90 },
    });
    expect(decideQuota({ entitlement, currentUsage: 80, requested: 30 })).toMatchObject({
      outcome: 'deny',
      code: 'QUOTA_EXCEEDED',
      remaining: -10,
      reservation: null,
    });
  });

  it('allows soft overage but still returns a reservation warning', () => {
    const entitlement = meteredEntitlement({
      value: { limit: 100, unit: 'bytes', limitMode: 'soft' },
      limitMode: 'soft',
    });

    expect(decideQuota({ entitlement, currentUsage: 90, requested: 20 })).toMatchObject({
      outcome: 'reserve',
      code: 'SOFT_LIMIT_EXCEEDED',
      remaining: -10,
      reservation: { required: true },
    });
  });

  it('returns pending when usage or an earlier reservation is unresolved', () => {
    const entitlement = meteredEntitlement();

    expect(decideQuota({ entitlement, requested: 10 })).toMatchObject({
      outcome: 'pending',
      code: 'USAGE_UNAVAILABLE',
    });
    expect(
      decideQuota({
        entitlement,
        currentUsage: 10,
        requested: 10,
        existingReservation: { idempotencyKey: 'op-1', status: 'pending', quantity: 10 },
      }),
    ).toMatchObject({ outcome: 'pending', code: 'RESERVATION_PENDING' });
  });

  it('is idempotent for a committed reservation and denies missing entitlements', () => {
    const entitlement = meteredEntitlement();
    expect(
      decideQuota({
        entitlement,
        currentUsage: 100,
        requested: 10,
        existingReservation: { idempotencyKey: 'op-1', status: 'committed', quantity: 10 },
      }),
    ).toMatchObject({ outcome: 'allow', code: 'RESERVATION_ALREADY_COMMITTED' });
    expect(decideQuota({ requested: 1 })).toMatchObject({
      outcome: 'deny',
      code: 'ENTITLEMENT_NOT_FOUND',
    });
  });
});
