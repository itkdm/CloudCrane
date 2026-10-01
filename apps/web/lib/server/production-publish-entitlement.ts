import {
  BILLING_FEATURES,
  decideQuota,
  resolveEntitlements,
  type EntitlementGrant,
  type JsonValue,
} from '@cloudcrane/billing';

export type ProductionEntitlementGrantRow = {
  id: string;
  featureKey: string;
  valueType: string;
  value: Record<string, unknown>;
  scope: string;
  scopeId: string | null;
  startsAt: Date;
  endsAt: Date | null;
};

export type ProductionAdmission =
  | { allowed: true }
  | {
      allowed: false;
      code: 'PRODUCTION_DISABLED' | 'PRODUCTION_QUOTA_EXCEEDED' | 'ENTITLEMENT_UNAVAILABLE';
    };

export function mapProductionEntitlementGrants(
  rows: readonly ProductionEntitlementGrantRow[],
  billingAccountId: string,
): EntitlementGrant[] {
  const grants: EntitlementGrant[] = [];
  for (const row of rows) {
    const scope = row.scope as EntitlementGrant['scope'];
    const scopeId = row.scopeId ?? (scope === 'account' ? billingAccountId : '');
    if (!scopeId) continue;
    const base = {
      id: row.id,
      featureKey: row.featureKey,
      scope,
      scopeId,
      period: { kind: 'lifetime' as const },
      effectiveAt: row.startsAt,
      expiresAt: row.endsAt,
      source: { type: 'entitlement_grant', id: row.id },
    };
    if (row.valueType === 'boolean') {
      grants.push({ ...base, valueType: 'boolean', value: row.value.enabled === true });
    } else if (row.valueType === 'metered') {
      const value = row.value;
      const limit = value.limit;
      const unit = value.unit;
      const limitMode = value.limitMode;
      if (
        typeof limit === 'number' &&
        typeof unit === 'string' &&
        (limitMode === 'hard' || limitMode === 'soft' || limitMode === 'unlimited')
      ) {
        grants.push({
          ...base,
          valueType: 'metered',
          value: { limit, unit, limitMode },
        });
      }
    } else if (row.valueType === 'static') {
      grants.push({ ...base, valueType: 'static', value: row.value as JsonValue });
    }
  }
  return grants;
}

export function decideProductionAdmission(input: {
  grants: readonly EntitlementGrant[];
  billingAccountId: string;
  currentWebsiteUsage: number;
  alreadyHasRuntime: boolean;
}): ProductionAdmission {
  const resolved = resolveEntitlements({
    grants: input.grants,
    scope: 'account',
    scopeId: input.billingAccountId,
  });
  const enabled = resolved.find((item) => item.featureKey === BILLING_FEATURES.productionEnabled);
  if (!enabled || enabled.valueType !== 'boolean' || enabled.value !== true)
    return { allowed: false, code: 'PRODUCTION_DISABLED' };

  if (input.alreadyHasRuntime) return { allowed: true };
  const quota = resolved.find(
    (item) => item.featureKey === BILLING_FEATURES.productionWebsiteCount,
  );
  const decision = decideQuota({
    entitlement: quota,
    currentUsage: input.currentWebsiteUsage,
    requested: 1,
  });
  if (decision.outcome === 'allow' || decision.outcome === 'reserve') return { allowed: true };
  if (decision.code === 'ENTITLEMENT_NOT_FOUND' || decision.code === 'INVALID_ENTITLEMENT')
    return { allowed: false, code: 'ENTITLEMENT_UNAVAILABLE' };
  return { allowed: false, code: 'PRODUCTION_QUOTA_EXCEEDED' };
}
