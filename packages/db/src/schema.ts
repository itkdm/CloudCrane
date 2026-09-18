import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  boolean,
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
    status: varchar('status', { length: 32 }).notNull(),
    cmsType: varchar('cms_type', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).default(now()).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(now()).notNull(),
  },
  (table) => [index('website_owner_id_idx').on(table.ownerId)],
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
  },
  (table) => [index('website_session_website_id_idx').on(table.websiteId)],
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

export type Website = typeof website.$inferSelect;
export type User = typeof user.$inferSelect;
export type Workspace = typeof workspace.$inferSelect;
export type WebsiteSession = typeof websiteSession.$inferSelect;
export type AgentRun = typeof agentRun.$inferSelect;
export type Runner = typeof runner.$inferSelect;
