export const ENTITLEMENT_SCOPES = [
  'account',
  'website',
  'workspace',
  'session',
  'production',
] as const;

export type EntitlementScope = (typeof ENTITLEMENT_SCOPES)[number];

export const ENTITLEMENT_VALUE_TYPES = ['boolean', 'static', 'metered'] as const;
export type EntitlementValueType = (typeof ENTITLEMENT_VALUE_TYPES)[number];

export const LIMIT_MODES = ['hard', 'soft', 'unlimited'] as const;
export type LimitMode = (typeof LIMIT_MODES)[number];

export const GRANT_STACKING_POLICIES = ['replace', 'add', 'max'] as const;
export type GrantStackingPolicy = (typeof GRANT_STACKING_POLICIES)[number];

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type EntitlementPeriod =
  | { kind: 'lifetime' }
  | { kind: 'billing_period'; start: Date; end: Date }
  | { kind: 'rolling_window'; durationMs: number };

export type EntitlementSource = {
  type: string;
  id: string;
};

export type MeteredEntitlementValue = {
  limit: number | null;
  unit: string;
  limitMode: LimitMode;
};

type EntitlementGrantBase = {
  id: string;
  featureKey: string;
  scope: EntitlementScope;
  scopeId: string;
  period: EntitlementPeriod;
  effectiveAt: Date;
  expiresAt?: Date | null;
  priority?: number;
  stacking?: GrantStackingPolicy;
  source?: EntitlementSource;
};

export type BooleanEntitlementGrant = EntitlementGrantBase & {
  valueType: 'boolean';
  value: boolean;
  limitMode?: LimitMode;
};

export type StaticEntitlementGrant = EntitlementGrantBase & {
  valueType: 'static';
  value: JsonValue;
  limitMode?: LimitMode;
};

export type MeteredEntitlementGrant = EntitlementGrantBase & {
  valueType: 'metered';
  value: MeteredEntitlementValue;
};

export type EntitlementGrant =
  BooleanEntitlementGrant | StaticEntitlementGrant | MeteredEntitlementGrant;

export type EntitlementResolutionInput = {
  grants: readonly EntitlementGrant[];
  scope: EntitlementScope;
  scopeId: string;
  at?: Date;
};

export type EntitlementContribution = {
  grantId: string;
  featureKey: string;
  priority: number;
  stacking: GrantStackingPolicy;
  source: EntitlementSource;
  period: EntitlementPeriod;
  valueType: EntitlementValueType;
};

export type ResolvedEntitlement = {
  featureKey: string;
  scope: EntitlementScope;
  scopeId: string;
  valueType: EntitlementValueType;
  value: boolean | JsonValue | MeteredEntitlementValue;
  limitMode: LimitMode;
  period: EntitlementPeriod;
  effectiveAt: Date;
  expiresAt: Date | null;
  priority: number;
  stacking: GrantStackingPolicy;
  contributions: readonly EntitlementContribution[];
  explanation: string;
};

export const QUOTA_DECISION_CODES = {
  ALLOWED: 'ALLOWED',
  ENTITLEMENT_NOT_FOUND: 'ENTITLEMENT_NOT_FOUND',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_ENTITLEMENT: 'INVALID_ENTITLEMENT',
  USAGE_UNAVAILABLE: 'USAGE_UNAVAILABLE',
  RESERVATION_PENDING: 'RESERVATION_PENDING',
  RESERVATION_ALREADY_COMMITTED: 'RESERVATION_ALREADY_COMMITTED',
  QUOTA_RESERVED: 'QUOTA_RESERVED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  SOFT_LIMIT_EXCEEDED: 'SOFT_LIMIT_EXCEEDED',
} as const;

export type QuotaDecisionCode = (typeof QUOTA_DECISION_CODES)[keyof typeof QUOTA_DECISION_CODES];
export type QuotaDecisionOutcome = 'allow' | 'deny' | 'reserve' | 'pending';

export type ReservationState = {
  idempotencyKey: string;
  status: 'pending' | 'committed' | 'released' | 'expired';
  quantity: number;
};

export type QuotaDecisionInput = {
  entitlement?: ResolvedEntitlement;
  requested: number;
  /** Committed usage plus any active reservations in the same quota period. */
  currentUsage?: number;
  existingReservation?: ReservationState;
};

export type ReservationDecision = {
  required: true;
  quantity: number;
  usageBefore: number;
  usageAfter: number;
  limit: number;
  remaining: number;
};

export type QuotaDecision = {
  outcome: QuotaDecisionOutcome;
  code: QuotaDecisionCode;
  explanation: string;
  featureKey: string | null;
  scope: EntitlementScope | null;
  scopeId: string | null;
  requested: number;
  usageBefore: number | null;
  usageAfter: number | null;
  remaining: number | null;
  reservation: ReservationDecision | null;
};

export class EntitlementResolutionError extends Error {
  constructor(
    public readonly code:
      | 'ENTITLEMENT_TYPE_CONFLICT'
      | 'ENTITLEMENT_UNIT_CONFLICT'
      | 'ENTITLEMENT_PERIOD_CONFLICT'
      | 'ENTITLEMENT_STACKING_CONFLICT',
    featureKey: string,
  ) {
    super(`${code}: ${featureKey}`);
    this.name = 'EntitlementResolutionError';
  }
}

const DEFAULT_SOURCE: EntitlementSource = { type: 'unknown', id: 'unknown' };

export function resolveEntitlements({
  grants,
  scope,
  scopeId,
  at = new Date(),
}: EntitlementResolutionInput): ResolvedEntitlement[] {
  assertDate(at, 'at');
  if (!scopeId) throw new RangeError('scopeId must not be empty');

  const activeGrants = grants.filter(
    (grant) => grant.scope === scope && grant.scopeId === scopeId && isGrantActive(grant, at),
  );
  const grouped = new Map<string, EntitlementGrant[]>();

  for (const grant of activeGrants) {
    const group = grouped.get(grant.featureKey) ?? [];
    group.push(grant);
    grouped.set(grant.featureKey, group);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([featureKey, featureGrants]) =>
      resolveFeature(featureKey, featureGrants, scope, scopeId),
    );
}

export function decideQuota({
  entitlement,
  requested,
  currentUsage,
  existingReservation,
}: QuotaDecisionInput): QuotaDecision {
  const context = entitlementContext(entitlement);

  if (!Number.isFinite(requested) || requested <= 0) {
    return decision(
      'deny',
      'INVALID_REQUEST',
      'Requested quantity must be greater than zero.',
      context,
      requested,
    );
  }

  if (!entitlement) {
    return decision(
      'deny',
      'ENTITLEMENT_NOT_FOUND',
      'No active entitlement applies to this feature and scope.',
      context,
      requested,
    );
  }

  if (existingReservation?.status === 'pending') {
    return decision(
      'pending',
      'RESERVATION_PENDING',
      'An earlier reservation for this operation is still pending.',
      context,
      requested,
      currentUsage,
    );
  }

  if (existingReservation?.status === 'committed') {
    return decision(
      'allow',
      'RESERVATION_ALREADY_COMMITTED',
      'The reservation for this idempotency key has already been committed.',
      context,
      requested,
      currentUsage,
    );
  }

  if (entitlement.valueType === 'boolean') {
    return entitlement.value
      ? decision('allow', 'ALLOWED', 'The boolean entitlement is enabled.', context, requested)
      : decision(
          'deny',
          'FEATURE_DISABLED',
          'The boolean entitlement is disabled.',
          context,
          requested,
        );
  }

  if (entitlement.valueType === 'static') {
    return decision(
      'allow',
      'ALLOWED',
      'A static entitlement is present for this scope.',
      context,
      requested,
    );
  }

  if (currentUsage === undefined || !Number.isFinite(currentUsage) || currentUsage < 0) {
    return decision(
      'pending',
      'USAGE_UNAVAILABLE',
      'Trusted current usage is unavailable, so quota admission is pending.',
      context,
      requested,
      currentUsage,
    );
  }

  const metered = entitlement.value;
  if (!isMeteredValue(metered)) {
    return decision(
      'deny',
      'INVALID_ENTITLEMENT',
      'The resolved metered entitlement has an invalid value.',
      context,
      requested,
      currentUsage,
    );
  }

  const usageAfter = currentUsage + requested;
  if (metered.limitMode === 'unlimited') {
    return decision(
      'allow',
      'ALLOWED',
      `The ${metered.unit} entitlement is unlimited.`,
      context,
      requested,
      currentUsage,
      usageAfter,
    );
  }

  if (metered.limit === null || !Number.isFinite(metered.limit) || metered.limit < 0) {
    return decision(
      'deny',
      'INVALID_ENTITLEMENT',
      'The resolved metered entitlement has an invalid finite limit.',
      context,
      requested,
      currentUsage,
      usageAfter,
    );
  }

  const remaining = metered.limit - usageAfter;
  const reservation = {
    required: true as const,
    quantity: requested,
    usageBefore: currentUsage,
    usageAfter,
    limit: metered.limit,
    remaining,
  };

  if (remaining < 0 && metered.limitMode === 'hard') {
    return decision(
      'deny',
      'QUOTA_EXCEEDED',
      `The ${metered.unit} hard quota would be exceeded by ${Math.abs(remaining)} ${metered.unit}.`,
      context,
      requested,
      currentUsage,
      usageAfter,
      remaining,
    );
  }

  if (remaining < 0) {
    return decision(
      'reserve',
      'SOFT_LIMIT_EXCEEDED',
      `The ${metered.unit} soft quota is exceeded, but the operation is allowed with an overage warning.`,
      context,
      requested,
      currentUsage,
      usageAfter,
      remaining,
      reservation,
    );
  }

  return decision(
    'reserve',
    'QUOTA_RESERVED',
    `The operation fits within the ${metered.unit} quota and requires an atomic reservation.`,
    context,
    requested,
    currentUsage,
    usageAfter,
    remaining,
    reservation,
  );
}

function resolveFeature(
  featureKey: string,
  grants: EntitlementGrant[],
  scope: EntitlementScope,
  scopeId: string,
): ResolvedEntitlement {
  const sorted = [...grants].sort(compareGrants);
  const valueTypes = new Set(sorted.map((grant) => grant.valueType));
  if (valueTypes.size !== 1) {
    throw new EntitlementResolutionError('ENTITLEMENT_TYPE_CONFLICT', featureKey);
  }

  const replacement = sorted.find((grant) => (grant.stacking ?? 'replace') === 'replace');
  if (replacement) {
    return resolvedFromSingleGrant(replacement, sorted, scope, scopeId);
  }

  if (sorted[0]?.valueType !== 'metered') {
    throw new EntitlementResolutionError('ENTITLEMENT_STACKING_CONFLICT', featureKey);
  }

  return resolveMeteredFeature(featureKey, sorted as MeteredEntitlementGrant[], scope, scopeId);
}

function resolveMeteredFeature(
  featureKey: string,
  grants: MeteredEntitlementGrant[],
  scope: EntitlementScope,
  scopeId: string,
): ResolvedEntitlement {
  const units = new Set(grants.map((grant) => grant.value.unit));
  if (units.size !== 1) {
    throw new EntitlementResolutionError('ENTITLEMENT_UNIT_CONFLICT', featureKey);
  }
  const periods = new Set(grants.map((grant) => periodKey(grant.period)));
  if (periods.size !== 1) {
    throw new EntitlementResolutionError('ENTITLEMENT_PERIOD_CONFLICT', featureKey);
  }

  const hasUnlimited = grants.some((grant) => grant.value.limitMode === 'unlimited');
  const addGrants = grants.filter((grant) => (grant.stacking ?? 'replace') === 'add');
  const maxGrants = grants.filter((grant) => (grant.stacking ?? 'replace') === 'max');
  const finiteAddLimit = addGrants.reduce((sum, grant) => sum + (grant.value.limit ?? 0), 0);
  const finiteMaxLimit = maxGrants.reduce(
    (maximum, grant) => Math.max(maximum, grant.value.limit ?? 0),
    0,
  );
  const limit = hasUnlimited ? null : Math.max(finiteAddLimit, finiteMaxLimit);
  const limitMode = hasUnlimited
    ? 'unlimited'
    : grants.some((grant) => grant.value.limitMode === 'hard')
      ? 'hard'
      : 'soft';
  const contributionGrants = [...grants].sort(compareGrants);
  const first = contributionGrants[0];
  if (!first) {
    throw new RangeError(`${featureKey} must have at least one active grant`);
  }

  return {
    featureKey,
    scope,
    scopeId,
    valueType: 'metered',
    value: { limit, unit: first.value.unit, limitMode },
    limitMode,
    period: clonePeriod(first.period),
    effectiveAt: earliestDate(grants.map((item) => item.effectiveAt)),
    expiresAt: latestExpiration(grants.map((item) => item.expiresAt ?? null)),
    priority: first.priority ?? 0,
    stacking: addGrants.length > 0 ? 'add' : 'max',
    contributions: contributionGrants.map(toContribution),
    explanation: hasUnlimited
      ? 'Unlimited metered grants are active; finite grants do not restrict this result.'
      : `Active metered grants are combined as add/max; effective limit is ${limit} ${first.value.unit}.`,
  };
}

function periodKey(period: EntitlementPeriod): string {
  switch (period.kind) {
    case 'lifetime':
      return 'lifetime';
    case 'rolling_window':
      return `rolling_window:${period.durationMs}`;
    case 'billing_period':
      return `billing_period:${period.start.toISOString()}:${period.end.toISOString()}`;
  }
}

function resolvedFromSingleGrant(
  grant: EntitlementGrant,
  allGrants: EntitlementGrant[],
  scope: EntitlementScope,
  scopeId: string,
): ResolvedEntitlement {
  const limitMode =
    grant.valueType === 'metered' ? grant.value.limitMode : (grant.limitMode ?? 'hard');
  return {
    featureKey: grant.featureKey,
    scope,
    scopeId,
    valueType: grant.valueType,
    value: cloneValue(grant.value),
    limitMode,
    period: clonePeriod(grant.period),
    effectiveAt: grant.effectiveAt,
    expiresAt: grant.expiresAt ?? null,
    priority: grant.priority ?? 0,
    stacking: grant.stacking ?? 'replace',
    contributions: allGrants.sort(compareGrants).map(toContribution),
    explanation: `Highest-priority active grant ${grant.id} supplies this entitlement.`,
  };
}

function toContribution(grant: EntitlementGrant): EntitlementContribution {
  return {
    grantId: grant.id,
    featureKey: grant.featureKey,
    priority: grant.priority ?? 0,
    stacking: grant.stacking ?? 'replace',
    source: { ...(grant.source ?? DEFAULT_SOURCE) },
    period: clonePeriod(grant.period),
    valueType: grant.valueType,
  };
}

function isGrantActive(grant: EntitlementGrant, at: Date): boolean {
  assertDate(grant.effectiveAt, `${grant.id}.effectiveAt`);
  if (grant.expiresAt !== undefined && grant.expiresAt !== null) {
    assertDate(grant.expiresAt, `${grant.id}.expiresAt`);
    if (grant.expiresAt <= grant.effectiveAt) {
      throw new RangeError(`${grant.id}.expiresAt must be after effectiveAt`);
    }
  }
  if (
    at < grant.effectiveAt ||
    (grant.expiresAt !== undefined && grant.expiresAt !== null && at >= grant.expiresAt)
  ) {
    return false;
  }
  if (grant.period.kind === 'billing_period') {
    assertDate(grant.period.start, `${grant.id}.period.start`);
    assertDate(grant.period.end, `${grant.id}.period.end`);
    if (grant.period.end <= grant.period.start) {
      throw new RangeError(`${grant.id}.period.end must be after period.start`);
    }
    return at >= grant.period.start && at < grant.period.end;
  }
  if (grant.period.kind === 'rolling_window' && grant.period.durationMs <= 0) {
    throw new RangeError(`${grant.id}.period.durationMs must be greater than zero`);
  }
  return true;
}

function compareGrants(left: EntitlementGrant, right: EntitlementGrant): number {
  const priority = (right.priority ?? 0) - (left.priority ?? 0);
  if (priority !== 0) return priority;
  const effective = right.effectiveAt.getTime() - left.effectiveAt.getTime();
  if (effective !== 0) return effective;
  return compareStrings(left.id, right.id);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function earliestDate(dates: Date[]): Date {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function latestExpiration(dates: Array<Date | null>): Date | null {
  if (dates.some((date) => date === null)) return null;
  return new Date(Math.max(...dates.map((date) => (date as Date).getTime())));
}

function clonePeriod(period: EntitlementPeriod): EntitlementPeriod {
  if (period.kind === 'billing_period') {
    return { kind: period.kind, start: new Date(period.start), end: new Date(period.end) };
  }
  return { ...period };
}

function cloneValue(value: EntitlementGrant['value']): EntitlementGrant['value'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  return { ...value } as JsonValue;
}

function isMeteredValue(value: ResolvedEntitlement['value']): value is MeteredEntitlementValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'limit' in value &&
    'unit' in value &&
    'limitMode' in value &&
    typeof value.limitMode === 'string'
  );
}

function entitlementContext(entitlement?: ResolvedEntitlement): {
  featureKey: string | null;
  scope: EntitlementScope | null;
  scopeId: string | null;
} {
  return entitlement
    ? { featureKey: entitlement.featureKey, scope: entitlement.scope, scopeId: entitlement.scopeId }
    : { featureKey: null, scope: null, scopeId: null };
}

function decision(
  outcome: QuotaDecisionOutcome,
  code: QuotaDecisionCode,
  explanation: string,
  context: ReturnType<typeof entitlementContext>,
  requested: number,
  usageBefore: number | undefined = undefined,
  usageAfter: number | undefined = undefined,
  remaining: number | undefined = undefined,
  reservation: ReservationDecision | null = null,
): QuotaDecision {
  return {
    outcome,
    code,
    explanation,
    ...context,
    requested,
    usageBefore: usageBefore ?? null,
    usageAfter: usageAfter ?? null,
    remaining: remaining ?? null,
    reservation,
  };
}

function assertDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}
