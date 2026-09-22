import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  boolean,
  bigint,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const now = () => sql`now()`;

export const website = pgTable(
  'website',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 255 }).notNull(),
    previewSlug: varchar('preview_slug', { length: 12 }).notNull().unique(),
    status: varchar('status', { length: 32 }).notNull(),
    cmsType: varchar('cms_type', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [index('website_owner_id_idx').on(table.ownerId)],
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
    providerId: varchar('provider_id', { length: 128 }).notNull(),
    modelId: varchar('model_id', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    baseUrl: text('base_url'),
    api: varchar('api', { length: 64 }),
    input: jsonb('input').$type<string[]>().notNull().default(sql`'["text"]'::jsonb`),
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
  (table) => [index('workspace_website_id_idx').on(table.websiteId)],
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
      sql`${table.status} in ('ready', 'failed', 'deleting', 'deleted')`,
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
