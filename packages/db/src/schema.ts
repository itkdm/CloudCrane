import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const now = () => sql`now()`;

export const website = pgTable('website', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  cmsType: varchar('cms_type', { length: 64 }).notNull(),
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
export type Workspace = typeof workspace.$inferSelect;
export type WebsiteSession = typeof websiteSession.$inferSelect;
export type AgentRun = typeof agentRun.$inferSelect;
export type Runner = typeof runner.$inferSelect;
