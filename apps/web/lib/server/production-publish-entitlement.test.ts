import { describe, expect, it } from 'vitest';
import {
  mapProductionEntitlementGrants,
  decideProductionAdmission,
} from './production-publish-entitlement.js';

const billingAccountId = '00000000-0000-4000-8000-000000000001';
const grants = [
  {
    id: 'enabled',
    featureKey: 'production.enabled',
    valueType: 'boolean',
    value: { enabled: true },
    scope: 'account',
    scopeId: null,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: null,
  },
  {
    id: 'quota',
    featureKey: 'production.website_count',
    valueType: 'metered',
    value: { limit: 2, unit: 'websites', limitMode: 'hard' },
    scope: 'account',
    scopeId: null,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: null,
  },
] as const;

describe('Production entitlement admission', () => {
  it('requires production.enabled and reserves within the account website quota', () => {
    const mapped = mapProductionEntitlementGrants(grants, billingAccountId);
    expect(
      decideProductionAdmission({
        grants: mapped,
        billingAccountId,
        currentWebsiteUsage: 1,
        alreadyHasRuntime: false,
      }),
    ).toEqual({ allowed: true });
    expect(
      decideProductionAdmission({
        grants: mapped,
        billingAccountId,
        currentWebsiteUsage: 2,
        alreadyHasRuntime: false,
      }),
    ).toEqual({ allowed: false, code: 'PRODUCTION_QUOTA_EXCEEDED' });
  });

  it('lets a site with an existing runtime republish without reserving a second slot', () => {
    expect(
      decideProductionAdmission({
        grants: mapProductionEntitlementGrants(grants, billingAccountId),
        billingAccountId,
        currentWebsiteUsage: 2,
        alreadyHasRuntime: true,
      }),
    ).toEqual({ allowed: true });
  });

  it('rejects the default free-preview account without production entitlement', () => {
    expect(
      decideProductionAdmission({
        grants: mapProductionEntitlementGrants(
          [
            {
              ...grants[0],
              value: { enabled: false },
            },
            grants[1],
          ],
          billingAccountId,
        ),
        billingAccountId,
        currentWebsiteUsage: 0,
        alreadyHasRuntime: false,
      }),
    ).toEqual({ allowed: false, code: 'PRODUCTION_DISABLED' });
  });
});
