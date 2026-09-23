import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  boolean,
  bigint,
  check,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const now = () => sql`now()`;

export const website = pgTable(
  'website',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    billingAccountId: uuid('billing_account_id').references(() => billingAccount.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    previewSlug: varchar('preview_slug', { length: 12 }).notNull().unique(),
    status: varchar('status', { length: 32 }).notNull(),
    cmsType: varchar('cms_type', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    index('website_owner_id_idx').on(table.ownerId),
    index('website_billing_account_id_idx').on(table.billingAccountId),
  ],
);

export const template = pgTable(
  'template',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceWebsiteId: uuid('source_website_id').references(() => website.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 64 }).notNull(),
    coverUrl: text('cover_url'),
    demoUrl: text('demo_url'),
    cmsType: varchar('cms_type', { length: 64 }).notNull(),
    artifactStorageKey: text('artifact_storage_key').notNull().unique(),
    artifactSha256: varchar('artifact_sha256', { length: 64 }).notNull(),
    artifactSize: integer('artifact_size').notNull(),
    artifactType: varchar('artifact_type', { length: 64 })
      .notNull()
      .default('legacy-theme-reference'),
    snapshotSchemaVersion: integer('snapshot_schema_version'),
    sourcePbootVersion: varchar('source_pboot_version', { length: 32 }),
    sourceCoreCommit: varchar('source_core_commit', { length: 64 }),
    dbEngine: varchar('db_engine', { length: 32 }),
    dbSchemaVersion: varchar('db_schema_version', { length: 32 }),
    status: varchar('status', { length: 32 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    index('template_status_sort_order_idx').on(table.status, table.sortOrder),
    check('template_status_check', sql`${table.status} in ('draft', 'published', 'hidden')`),
    check('template_artifact_sha256_check', sql`${table.artifactSha256} ~ '^[0-9a-f]{64}$'`),
    check('template_artifact_size_check', sql`${table.artifactSize} > 0`),
    check(
      'template_artifact_type_check',
      sql`${table.artifactType} in ('legacy-theme-reference', 'cloudcrane-pboot-site-snapshot')`,
    ),
    check(
      'template_snapshot_metadata_check',
      sql`(${table.artifactType} = 'legacy-theme-reference') OR (${table.snapshotSchemaVersion} is not null and ${table.sourcePbootVersion} is not null and ${table.sourceCoreCommit} is not null and ${table.dbEngine} is not null and ${table.dbSchemaVersion} is not null)`,
    ),
  ],
);

// Better Auth core schema. Keep these names aligned with the adapter defaults.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonated_by'),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
});

export const userModelProfile = pgTable(
  'user_model_profile',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerKind: varchar('provider_kind', { length: 32 }).notNull(),
    presetId: varchar('preset_id', { length: 128 }),
    providerName: varchar('provider_name', { length: 128 }).notNull().default('Custom provider'),
    providerId: varchar('provider_id', { length: 128 }).notNull(),
    modelId: varchar('model_id', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    baseUrl: text('base_url'),
    api: varchar('api', { length: 64 }),
    input: jsonb('input')
      .$type<string[]>()
      .notNull()
      .default(sql`'["text"]'::jsonb`),
    reasoning: boolean('reasoning').notNull().default(false),
    contextWindow: integer('context_window').notNull().default(128000),
    maxTokens: integer('max_tokens').notNull().default(16384),
    apiKeyCiphertext: text('api_key_ciphertext').notNull(),
    apiKeyIv: varchar('api_key_iv', { length: 32 }).notNull(),
    apiKeyAuthTag: varchar('api_key_auth_tag', { length: 32 }).notNull(),
    encryptionKeyVersion: varchar('encryption_key_version', { length: 32 }).notNull(),
    keyHint: varchar('key_hint', { length: 16 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    index('user_model_profile_user_id_idx').on(table.userId),
    check(
      'user_model_profile_provider_kind_check',
      sql`${table.providerKind} in ('builtin', 'openai-compatible')`,
    ),
    check('user_model_profile_key_hint_check', sql`${table.keyHint} <> ''`),
  ],
);

export const runner = pgTable('runner', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
});

export const workspace = pgTable(
  'workspace',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .notNull()
      .references(() => website.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 64 }).notNull(),
    runnerId: uuid('runner_id').references(() => runner.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 32 }).notNull(),
    containerRef: text('container_ref'),
    workspacePath: text('workspace_path'),
    previewPort: integer('preview_port'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [uniqueIndex('workspace_website_id_unique').on(table.websiteId)],
);

export const websiteShare = pgTable(
  'website_share',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .notNull()
      .references(() => website.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    lastAccessAt: timestamp('last_access_at', { withTimezone: true }),
    accessCount: integer('access_count').notNull().default(0),
  },
  (table) => [
    index('website_share_website_id_idx').on(table.websiteId),
    index('website_share_expires_at_idx').on(table.expiresAt),
    check('website_share_token_hash_check', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('website_share_access_count_check', sql`${table.accessCount} >= 0`),
  ],
);

export const websiteTemplateAttachment = pgTable(
  'website_template_attachment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .notNull()
      .references(() => website.id, { onDelete: 'cascade' })
      .unique(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => template.id, { onDelete: 'restrict' }),
    artifactStorageKey: text('artifact_storage_key').notNull(),
    artifactSha256: varchar('artifact_sha256', { length: 64 }).notNull(),
    referenceId: varchar('reference_id', { length: 128 }),
    status: varchar('status', { length: 32 }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('website_template_attachment_template_id_idx').on(table.templateId),
    index('website_template_attachment_status_idx').on(table.status),
    check(
      'website_template_attachment_status_check',
      sql`${table.status} in ('pending', 'materializing', 'ready', 'failed')`,
    ),
  ],
);

export const websiteSession = pgTable(
  'website_session',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .notNull()
      .references(() => website.id, { onDelete: 'cascade' }),
    piSessionId: varchar('pi_session_id', { length: 255 }).notNull(),
    sessionFile: text('session_file').notNull(),
    title: varchar('title', { length: 255 }),
    status: varchar('status', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    clonedFromSessionId: uuid('cloned_from_session_id'),
  },
  (table) => [
    index('website_session_website_id_idx').on(table.websiteId),
    index('website_session_pinned_at_idx').on(table.websiteId, table.pinnedAt),
    index('website_session_clone_source_idx').on(table.clonedFromSessionId),
  ],
);

export const conversationAttachment = pgTable(
  'conversation_attachment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    websiteId: uuid('website_id')
      .notNull()
      .references(() => website.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => websiteSession.id, { onDelete: 'cascade' }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 127 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    storageDriver: varchar('storage_driver', { length: 16 }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    status: varchar('status', { length: 32 }).notNull(),
    errorCode: varchar('error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('conversation_attachment_owner_session_idx').on(table.ownerId, table.sessionId),
    index('conversation_attachment_website_status_idx').on(table.websiteId, table.status),
    index('conversation_attachment_expiry_idx').on(table.status, table.expiresAt),
    check('conversation_attachment_kind_check', sql`${table.kind} in ('image', 'document')`),
    check(
      'conversation_attachment_status_check',
      sql`${table.status} in ('uploading', 'ready', 'failed', 'deleting', 'deleted')`,
    ),
    check('conversation_attachment_size_check', sql`${table.sizeBytes} > 0`),
    check('conversation_attachment_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const agentRun = pgTable(
  'agent_run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .notNull()
      .references(() => website.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => websiteSession.id, { onDelete: 'cascade' }),
    traceId: uuid('trace_id').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    model: varchar('model', { length: 255 }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    index('agent_run_website_id_idx').on(table.websiteId),
    index('agent_run_session_id_idx').on(table.sessionId),
    index('agent_run_trace_id_idx').on(table.traceId),
  ],
);

export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).default(now()).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    actorType: varchar('actor_type', { length: 32 }).notNull(),
    // Audit evidence must outlive the business rows it describes. These are
    // intentionally unbound identifiers, not relational ownership edges.
    actorUserId: text('actor_user_id'),
    impersonatorUserId: text('impersonator_user_id'),
    websiteId: uuid('website_id'),
    workspaceId: uuid('workspace_id'),
    websiteSessionId: uuid('website_session_id'),
    agentRunId: uuid('agent_run_id'),
    traceId: varchar('trace_id', { length: 32 }),
    spanId: varchar('span_id', { length: 16 }),
    runCorrelationId: uuid('run_correlation_id'),
    requestId: varchar('request_id', { length: 255 }),
    toolCallId: varchar('tool_call_id', { length: 255 }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    operation: varchar('operation', { length: 128 }).notNull(),
    resourceType: varchar('resource_type', { length: 64 }),
    resourceRef: text('resource_ref'),
    status: varchar('status', { length: 32 }).notNull(),
    durationMs: integer('duration_ms'),
    errorCode: varchar('error_code', { length: 128 }),
    errorType: varchar('error_type', { length: 128 }),
    requestSummary: jsonb('request_summary').$type<Record<string, unknown>>(),
    resultSummary: jsonb('result_summary').$type<Record<string, unknown>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('audit_event_occurred_at_idx').on(table.occurredAt),
    index('audit_event_operation_status_idx').on(table.operation, table.status),
    index('audit_event_workspace_occurred_at_idx').on(table.workspaceId, table.occurredAt),
    index('audit_event_agent_run_occurred_at_idx').on(table.agentRunId, table.occurredAt),
    index('audit_event_trace_id_idx').on(table.traceId),
    index('audit_event_request_id_idx').on(table.requestId),
    check(
      'audit_event_actor_type_check',
      sql`${table.actorType} in ('user', 'agent', 'gateway', 'runner', 'system', 'admin')`,
    ),
    check(
      'audit_event_status_check',
      sql`${table.status} in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'UNKNOWN')`,
    ),
    check(
      'audit_event_duration_check',
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
    check(
      'audit_event_finished_at_check',
      sql`((${table.status} in ('PENDING', 'RUNNING') and ${table.finishedAt} is null) or (${table.status} in ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'UNKNOWN') and ${table.finishedAt} is not null))`,
    ),
  ],
);

export const billingAccount = pgTable(
  'billing_account',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: varchar('kind', { length: 32 }).notNull().default('personal'),
    personalOwnerUserId: text('personal_owner_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    index('billing_account_status_idx').on(table.status),
    uniqueIndex('billing_account_personal_owner_unique')
      .on(table.personalOwnerUserId)
      .where(sql`${table.kind} = 'personal' and ${table.status} = 'active'`),
    check('billing_account_kind_check', sql`${table.kind} in ('personal', 'organization')`),
    check(
      'billing_account_status_check',
      sql`${table.status} in ('active', 'suspended', 'closed')`,
    ),
  ],
);

export const billingAccountMember = pgTable(
  'billing_account_member',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull().default('member'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('billing_account_member_account_user_unique').on(
      table.billingAccountId,
      table.userId,
    ),
    index('billing_account_member_user_id_idx').on(table.userId),
    check('billing_account_member_role_check', sql`${table.role} in ('owner', 'admin', 'member')`),
    check(
      'billing_account_member_status_check',
      sql`${table.status} in ('invited', 'active', 'removed')`,
    ),
  ],
);

export const plan = pgTable(
  'plan',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 128 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    index('plan_status_idx').on(table.status),
    check('plan_status_check', sql`${table.status} in ('draft', 'active', 'retired')`),
  ],
);

export const planVersion = pgTable(
  'plan_version',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plan.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    billingInterval: varchar('billing_interval', { length: 32 }).notNull().default('month'),
    intervalCount: integer('interval_count').notNull().default(1),
    priceAmount: numeric('price_amount', { precision: 30, scale: 0 }).notNull().default('0'),
    priceCurrency: varchar('price_currency', { length: 3 }).notNull().default('USD'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('plan_version_plan_version_unique').on(table.planId, table.version),
    index('plan_version_status_idx').on(table.status),
    check('plan_version_version_check', sql`${table.version} > 0`),
    check('plan_version_status_check', sql`${table.status} in ('draft', 'published', 'retired')`),
    check(
      'plan_version_billing_interval_check',
      sql`${table.billingInterval} in ('month', 'year', 'one_time')`,
    ),
    check('plan_version_interval_count_check', sql`${table.intervalCount} > 0`),
    check('plan_version_price_amount_check', sql`${table.priceAmount} >= 0`),
    check('plan_version_price_currency_check', sql`${table.priceCurrency} ~ '^[A-Z]{3}$'`),
  ],
);

export const entitlementDefinition = pgTable(
  'entitlement_definition',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 128 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    valueType: varchar('value_type', { length: 32 }).notNull(),
    unit: varchar('unit', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    index('entitlement_definition_value_type_idx').on(table.valueType),
    check(
      'entitlement_definition_value_type_check',
      sql`${table.valueType} in ('boolean', 'static', 'metered')`,
    ),
  ],
);

export const planEntitlement = pgTable(
  'plan_entitlement',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    planVersionId: uuid('plan_version_id')
      .notNull()
      .references(() => planVersion.id, { onDelete: 'cascade' }),
    entitlementDefinitionId: uuid('entitlement_definition_id')
      .notNull()
      .references(() => entitlementDefinition.id, { onDelete: 'restrict' }),
    enabled: boolean('enabled').notNull().default(true),
    value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('plan_entitlement_plan_version_definition_unique').on(
      table.planVersionId,
      table.entitlementDefinitionId,
    ),
    index('plan_entitlement_definition_id_idx').on(table.entitlementDefinitionId),
  ],
);

export const subscription = pgTable(
  'subscription',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'restrict' }),
    planVersionId: uuid('plan_version_id')
      .notNull()
      .references(() => planVersion.id, { onDelete: 'restrict' }),
    nextPlanVersionId: uuid('next_plan_version_id').references(() => planVersion.id, {
      onDelete: 'restrict',
    }),
    providerConnectionId: uuid('provider_connection_id'),
    providerSubscriptionRef: varchar('provider_subscription_ref', { length: 255 }),
    version: integer('version').notNull().default(1),
    status: varchar('status', { length: 32 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).default(now()).notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAt: timestamp('cancel_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    index('subscription_account_status_idx').on(table.billingAccountId, table.status),
    index('subscription_period_end_idx').on(table.currentPeriodEnd),
    uniqueIndex('subscription_account_current_unique')
      .on(table.billingAccountId)
      .where(sql`${table.status} in ('trialing', 'active', 'grace', 'canceling')`),
    check(
      'subscription_status_check',
      sql`${table.status} in ('trialing', 'pending_payment', 'active', 'grace', 'restricted', 'suspended', 'canceling', 'canceled', 'expired')`,
    ),
    check(
      'subscription_period_check',
      sql`(${table.currentPeriodStart} is null and ${table.currentPeriodEnd} is null) or (${table.currentPeriodStart} is not null and ${table.currentPeriodEnd} is not null and ${table.currentPeriodEnd} > ${table.currentPeriodStart})`,
    ),
    check('subscription_version_check', sql`${table.version} > 0`),
  ],
);

export const entitlementGrant = pgTable(
  'entitlement_grant',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'restrict' }),
    entitlementDefinitionId: uuid('entitlement_definition_id')
      .notNull()
      .references(() => entitlementDefinition.id, { onDelete: 'restrict' }),
    scope: varchar('scope', { length: 32 }).notNull().default('account'),
    scopeId: uuid('scope_id'),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    sourceRef: varchar('source_ref', { length: 255 }),
    value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }).default(now()).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    index('entitlement_grant_account_status_idx').on(table.billingAccountId, table.status),
    index('entitlement_grant_definition_idx').on(table.entitlementDefinitionId),
    index('entitlement_grant_scope_idx').on(table.scope, table.scopeId),
    check(
      'entitlement_grant_source_type_check',
      sql`${table.sourceType} in ('subscription', 'manual', 'promotion', 'system')`,
    ),
    check(
      'entitlement_grant_status_check',
      sql`${table.status} in ('active', 'revoked', 'expired')`,
    ),
    check(
      'entitlement_grant_period_check',
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      'entitlement_grant_scope_check',
      sql`${table.scope} in ('account', 'website', 'workspace', 'session', 'production')`,
    ),
  ],
);

export const operation = pgTable(
  'operation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'restrict' }),
    websiteId: uuid('website_id').references(() => website.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }),
    requestId: varchar('request_id', { length: 255 }),
    resultResourceId: uuid('result_resource_id'),
    retryCount: integer('retry_count').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    errorCode: varchar('error_code', { length: 128 }),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('operation_account_type_idempotency_unique').on(
      table.billingAccountId,
      table.type,
      table.idempotencyKey,
    ),
    index('operation_account_status_idx').on(table.billingAccountId, table.status),
    index('operation_website_id_idx').on(table.websiteId),
    check('operation_type_check', sql`${table.type} <> ''`),
    check(
      'operation_status_check',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'retryable', 'cancelled', 'expired')`,
    ),
    check(
      'operation_finished_at_check',
      sql`(${table.status} in ('pending', 'running', 'retryable') and ${table.finishedAt} is null) or (${table.status} in ('succeeded', 'failed', 'cancelled', 'expired') and ${table.finishedAt} is not null)`,
    ),
  ],
);

export const quotaReservation = pgTable(
  'quota_reservation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'restrict' }),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id, { onDelete: 'cascade' }),
    entitlementDefinitionId: uuid('entitlement_definition_id')
      .notNull()
      .references(() => entitlementDefinition.id, { onDelete: 'restrict' }),
    dimension: varchar('dimension', { length: 128 }).notNull().default(''),
    quantity: numeric('quantity', { precision: 30, scale: 0 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('reserved'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('quota_reservation_operation_definition_dimension_unique').on(
      table.operationId,
      table.entitlementDefinitionId,
      table.dimension,
    ),
    index('quota_reservation_account_status_idx').on(table.billingAccountId, table.status),
    index('quota_reservation_expiry_idx').on(table.status, table.expiresAt),
    check('quota_reservation_quantity_check', sql`${table.quantity} > 0`),
    check(
      'quota_reservation_status_check',
      sql`${table.status} in ('reserved', 'committed', 'released', 'expired')`,
    ),
  ],
);

export const usageEvent = pgTable(
  'usage_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'restrict' }),
    entitlementDefinitionId: uuid('entitlement_definition_id')
      .notNull()
      .references(() => entitlementDefinition.id, { onDelete: 'restrict' }),
    websiteId: uuid('website_id').references(() => website.id, { onDelete: 'set null' }),
    workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    websiteSessionId: uuid('website_session_id').references(() => websiteSession.id, {
      onDelete: 'set null',
    }),
    agentRunId: uuid('agent_run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    operationId: uuid('operation_id').references(() => operation.id, { onDelete: 'set null' }),
    quantity: numeric('quantity', { precision: 30, scale: 0 }).notNull(),
    dimension: varchar('dimension', { length: 128 }).notNull().default(''),
    source: varchar('source', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('usage_event_account_source_idempotency_unique').on(
      table.billingAccountId,
      table.source,
      table.idempotencyKey,
    ),
    index('usage_event_account_definition_occurred_idx').on(
      table.billingAccountId,
      table.entitlementDefinitionId,
      table.occurredAt,
    ),
    index('usage_event_website_occurred_idx').on(table.websiteId, table.occurredAt),
    check('usage_event_quantity_check', sql`${table.quantity} <> 0`),
    check('usage_event_source_check', sql`${table.source} <> ''`),
  ],
);

export const usageAggregate = pgTable(
  'usage_aggregate',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'restrict' }),
    entitlementDefinitionId: uuid('entitlement_definition_id')
      .notNull()
      .references(() => entitlementDefinition.id, { onDelete: 'restrict' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    dimension: varchar('dimension', { length: 128 }).notNull().default(''),
    totalQuantity: numeric('total_quantity', { precision: 30, scale: 0 }).notNull().default('0'),
    eventCount: integer('event_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('usage_aggregate_account_definition_period_dimension_unique').on(
      table.billingAccountId,
      table.entitlementDefinitionId,
      table.periodStart,
      table.periodEnd,
      table.dimension,
    ),
    index('usage_aggregate_period_idx').on(table.periodStart, table.periodEnd),
    check('usage_aggregate_period_check', sql`${table.periodEnd} > ${table.periodStart}`),
    check('usage_aggregate_quantity_check', sql`${table.totalQuantity} >= 0`),
    check('usage_aggregate_event_count_check', sql`${table.eventCount} >= 0`),
  ],
);

export const providerConnection = pgTable(
  'provider_connection',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'restrict' }),
    providerKey: varchar('provider_key', { length: 64 }).notNull(),
    environment: varchar('environment', { length: 32 }).notNull().default('live'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    credentialRef: varchar('credential_ref', { length: 255 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('provider_connection_account_provider_environment_unique').on(
      table.billingAccountId,
      table.providerKey,
      table.environment,
    ),
    index('provider_connection_provider_status_idx').on(table.providerKey, table.status),
    check('provider_connection_provider_key_check', sql`${table.providerKey} <> ''`),
    check('provider_connection_environment_check', sql`${table.environment} in ('test', 'live')`),
    check('provider_connection_status_check', sql`${table.status} in ('active', 'disabled')`),
  ],
);

export const providerExternalReference = pgTable(
  'provider_external_reference',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnection.id, { onDelete: 'restrict' }),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    localResourceType: varchar('local_resource_type', { length: 64 }).notNull(),
    localResourceId: uuid('local_resource_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('provider_external_reference_external_unique').on(
      table.providerConnectionId,
      table.resourceType,
      table.externalId,
    ),
    uniqueIndex('provider_external_reference_local_unique').on(
      table.providerConnectionId,
      table.localResourceType,
      table.localResourceId,
    ),
    index('provider_external_reference_local_lookup_idx').on(
      table.localResourceType,
      table.localResourceId,
    ),
  ],
);

export const providerEventInbox = pgTable(
  'provider_event_inbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnection.id, { onDelete: 'restrict' }),
    providerEventId: varchar('provider_event_id', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    signatureVerified: boolean('signature_verified').notNull().default(false),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    payloadSha256: varchar('payload_sha256', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('received'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).default(now()).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [
    uniqueIndex('provider_event_inbox_connection_event_unique').on(
      table.providerConnectionId,
      table.providerEventId,
    ),
    index('provider_event_inbox_status_retry_idx').on(table.status, table.nextAttemptAt),
    index('provider_event_inbox_received_at_idx').on(table.receivedAt),
    check('provider_event_inbox_event_id_check', sql`${table.providerEventId} <> ''`),
    check('provider_event_inbox_event_type_check', sql`${table.eventType} <> ''`),
    check(
      'provider_event_inbox_status_check',
      sql`${table.status} in ('received', 'processing', 'processed', 'failed', 'ignored')`,
    ),
    check('provider_event_inbox_attempt_count_check', sql`${table.attemptCount} >= 0`),
    check(
      'provider_event_inbox_payload_sha256_check',
      sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type Website = typeof website.$inferSelect;
export type Template = typeof template.$inferSelect;
export type WebsiteTemplateAttachment = typeof websiteTemplateAttachment.$inferSelect;
export type User = typeof user.$inferSelect;
export type Workspace = typeof workspace.$inferSelect;
export type WebsiteShare = typeof websiteShare.$inferSelect;
export type WebsiteSession = typeof websiteSession.$inferSelect;
export type ConversationAttachment = typeof conversationAttachment.$inferSelect;
export type AgentRun = typeof agentRun.$inferSelect;
export type Runner = typeof runner.$inferSelect;
export type AuditEvent = typeof auditEvent.$inferSelect;
export type BillingAccount = typeof billingAccount.$inferSelect;
export type BillingAccountMember = typeof billingAccountMember.$inferSelect;
export type Plan = typeof plan.$inferSelect;
export type PlanVersion = typeof planVersion.$inferSelect;
export type EntitlementDefinition = typeof entitlementDefinition.$inferSelect;
export type PlanEntitlement = typeof planEntitlement.$inferSelect;
export type Subscription = typeof subscription.$inferSelect;
export type EntitlementGrant = typeof entitlementGrant.$inferSelect;
export type Operation = typeof operation.$inferSelect;
export type QuotaReservation = typeof quotaReservation.$inferSelect;
export type UsageEvent = typeof usageEvent.$inferSelect;
export type UsageAggregate = typeof usageAggregate.$inferSelect;
export type ProviderConnection = typeof providerConnection.$inferSelect;
export type ProviderExternalReference = typeof providerExternalReference.$inferSelect;
export type ProviderEventInbox = typeof providerEventInbox.$inferSelect;
