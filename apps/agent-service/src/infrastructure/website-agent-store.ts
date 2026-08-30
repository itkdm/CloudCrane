import { and, eq, or } from 'drizzle-orm';
import type { PlatformDb } from '@cloudcrane/db';
import { agentRun, websiteSession } from '@cloudcrane/db';
import type {
  AgentRunIndex,
  AgentRunStatus,
  CreateRunIndex,
  CreateSessionIndex,
  WebsiteAgentStore,
  WebsiteSessionIndex,
  WebsiteSessionStatus,
} from '@cloudcrane/website-agent';

const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function mapSession(row: typeof websiteSession.$inferSelect): WebsiteSessionIndex {
  return {
    id: row.id,
    websiteId: row.websiteId,
    piSessionId: row.piSessionId,
    sessionFile: row.sessionFile,
    title: row.title,
    status: row.status === 'OPEN' ? 'ACTIVE' : (row.status as WebsiteSessionStatus),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActiveAt: toIso(row.lastActiveAt),
  };
}

function mapRun(row: typeof agentRun.$inferSelect): AgentRunIndex {
  return {
    id: row.id,
    websiteId: row.websiteId,
    sessionId: row.sessionId,
    traceId: row.traceId,
    status: row.status as AgentRunStatus,
    model: row.model,
    error: row.error,
    startedAt: toIso(row.startedAt),
    endedAt: toIso(row.endedAt),
  };
}

export class DrizzleWebsiteAgentStore implements WebsiteAgentStore {
  constructor(private readonly platform: PlatformDb) {}

  async findSession(
    websiteId: string,
    websiteSessionId: string,
  ): Promise<WebsiteSessionIndex | null> {
    const rows = await this.platform.db
      .select()
      .from(websiteSession)
      .where(and(eq(websiteSession.id, websiteSessionId), eq(websiteSession.websiteId, websiteId)))
      .limit(1);
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async createSession(input: CreateSessionIndex): Promise<WebsiteSessionIndex> {
    const rows = await this.platform.db
      .insert(websiteSession)
      .values({
        websiteId: input.websiteId,
        piSessionId: input.piSessionId,
        sessionFile: input.sessionFile,
        title: input.title,
        status: input.status,
        lastActiveAt: input.lastActiveAt ? new Date(input.lastActiveAt) : null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('website session was not created');
    return mapSession(row);
  }

  async updateSession(
    websiteSessionId: string,
    patch: Partial<WebsiteSessionIndex>,
  ): Promise<void> {
    const update: Partial<typeof websiteSession.$inferInsert> = {};
    if (patch.piSessionId !== undefined) update.piSessionId = patch.piSessionId;
    if (patch.sessionFile !== undefined) update.sessionFile = patch.sessionFile;
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.lastActiveAt !== undefined)
      update.lastActiveAt = patch.lastActiveAt ? new Date(patch.lastActiveAt) : null;
    if (patch.updatedAt !== undefined) update.updatedAt = new Date(patch.updatedAt);
    if (Object.keys(update).length === 0) return;
    await this.platform.db
      .update(websiteSession)
      .set(update)
      .where(eq(websiteSession.id, websiteSessionId));
  }

  async createRun(input: CreateRunIndex): Promise<AgentRunIndex> {
    const rows = await this.platform.db
      .insert(agentRun)
      .values({
        ...(input.id ? { id: input.id } : {}),
        websiteId: input.websiteId,
        sessionId: input.sessionId,
        traceId: input.traceId,
        status: input.status,
        model: input.model,
        error: input.error,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        endedAt: input.endedAt ? new Date(input.endedAt) : null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('agent run was not created');
    return mapRun(row);
  }

  async updateRun(runId: string, patch: Partial<AgentRunIndex>): Promise<void> {
    const update: Partial<typeof agentRun.$inferInsert> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.model !== undefined) update.model = patch.model;
    if (patch.error !== undefined) update.error = patch.error;
    if (patch.startedAt !== undefined)
      update.startedAt = patch.startedAt ? new Date(patch.startedAt) : null;
    if (patch.endedAt !== undefined)
      update.endedAt = patch.endedAt ? new Date(patch.endedAt) : null;
    if (Object.keys(update).length === 0) return;
    await this.platform.db.update(agentRun).set(update).where(eq(agentRun.id, runId));
  }

  async recoverStaleRuns(websiteId: string): Promise<void> {
    await this.platform.db
      .update(agentRun)
      .set({ status: 'INTERRUPTED', endedAt: new Date() })
      .where(
        and(
          eq(agentRun.websiteId, websiteId),
          or(eq(agentRun.status, 'PENDING'), eq(agentRun.status, 'RUNNING')),
        ),
      );
  }
}
