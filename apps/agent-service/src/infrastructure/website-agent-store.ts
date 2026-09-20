import { and, eq, or, sql } from 'drizzle-orm';
import {
  agentRun,
  auditEvent,
  finishAuditEvent,
  insertAuditEvent,
  type PlatformDb,
} from '@cloudcrane/db';
import { websiteSession } from '@cloudcrane/db';
import type {
  AgentRunIndex,
  AgentRunStatus,
  CreateRunIndex,
  CreateSessionIndex,
  WebsiteAgentStore,
  WebsiteSessionIndex,
  WebsiteSessionStatus,
} from '@cloudcrane/website-agent';
import { createLogger, getLogContext, serializeError } from '@cloudcrane/shared';

const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function mapSession(row: typeof websiteSession.$inferSelect): WebsiteSessionIndex {
  return {
    id: row.id,
    websiteId: row.websiteId,
    piSessionId: row.piSessionId,
    sessionFile: row.sessionFile,
    title: row.title,
    pinnedAt: toIso(row.pinnedAt),
    clonedFromSessionId: row.clonedFromSessionId,
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

  async listSessions(websiteId: string): Promise<WebsiteSessionIndex[]> {
    const rows = await this.platform.db
      .select()
      .from(websiteSession)
      .where(eq(websiteSession.websiteId, websiteId))
      .orderBy(
        sql`${websiteSession.pinnedAt} desc nulls last`,
        sql`${websiteSession.lastActiveAt} desc nulls last`,
        sql`${websiteSession.createdAt} desc`,
        sql`${websiteSession.id} desc`,
      );
    return rows.map(mapSession);
  }

  async createSession(input: CreateSessionIndex): Promise<WebsiteSessionIndex> {
    const rows = await this.platform.db
      .insert(websiteSession)
      .values({
        websiteId: input.websiteId,
        piSessionId: input.piSessionId,
        sessionFile: input.sessionFile,
        title: input.title,
        pinnedAt: input.pinnedAt ? new Date(input.pinnedAt) : null,
        clonedFromSessionId: input.clonedFromSessionId ?? null,
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
    if (patch.pinnedAt !== undefined)
      update.pinnedAt = patch.pinnedAt ? new Date(patch.pinnedAt) : null;
    if (patch.clonedFromSessionId !== undefined)
      update.clonedFromSessionId = patch.clonedFromSessionId;
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

  async deleteSession(websiteId: string, websiteSessionId: string): Promise<void> {
    await this.platform.db
      .delete(websiteSession)
      .where(and(eq(websiteSession.id, websiteSessionId), eq(websiteSession.websiteId, websiteId)));
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
    try {
      const observabilityContext = getLogContext();
      await insertAuditEvent(this.platform.db, {
        actorType: 'agent',
        websiteId: row.websiteId,
        websiteSessionId: row.sessionId,
        agentRunId: row.id,
        traceId: observabilityContext.traceId,
        spanId: observabilityContext.spanId,
        runCorrelationId: row.traceId,
        requestId: observabilityContext.requestId,
        operation: 'agent.run',
        resourceType: 'agent_run',
        resourceRef: row.id,
        status: 'PENDING',
        requestSummary: { hasModel: Boolean(row.model) },
      });
    } catch (error) {
      await this.platform.db.delete(agentRun).where(eq(agentRun.id, row.id));
      throw new Error('agent run audit is unavailable', { cause: error });
    }
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
    if (patch.status && ['COMPLETED', 'FAILED', 'ABORTED', 'INTERRUPTED'].includes(patch.status)) {
      const [pendingAudit] = await this.platform.db
        .select({ id: auditEvent.id, occurredAt: auditEvent.occurredAt })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.agentRunId, runId),
            eq(auditEvent.operation, 'agent.run'),
            or(eq(auditEvent.status, 'PENDING'), eq(auditEvent.status, 'RUNNING')),
          ),
        )
        .limit(1);
      if (pendingAudit) {
        const terminalStatus =
          patch.status === 'COMPLETED'
            ? 'SUCCESS'
            : patch.status === 'ABORTED'
              ? 'CANCELLED'
              : patch.status === 'INTERRUPTED'
                ? 'UNKNOWN'
                : 'FAILED';
        try {
          await finishAuditEvent(this.platform.db, pendingAudit.id, {
            status: terminalStatus,
            durationMs: patch.endedAt
              ? Math.max(0, new Date(patch.endedAt).getTime() - pendingAudit.occurredAt.getTime())
              : undefined,
            errorCode: patch.status === 'FAILED' ? 'AGENT_RUN_FAILED' : undefined,
            resultSummary: { status: patch.status },
          });
        } catch (error) {
          createLogger('website-agent.audit').error(
            {
              event: 'audit.finalization.failed',
              auditEventId: pendingAudit.id,
              outcome: 'unknown',
              ...serializeError(error),
            },
            'agent run completed but audit finalization failed',
          );
        }
      }
    }
  }

  async recoverStaleRuns(websiteId: string): Promise<void> {
    const staleRuns = await this.platform.db
      .select({ id: agentRun.id, startedAt: agentRun.startedAt })
      .from(agentRun)
      .where(
        and(
          eq(agentRun.websiteId, websiteId),
          or(eq(agentRun.status, 'PENDING'), eq(agentRun.status, 'RUNNING')),
        ),
      );
    await this.platform.db
      .update(agentRun)
      .set({ status: 'INTERRUPTED', endedAt: new Date() })
      .where(
        and(
          eq(agentRun.websiteId, websiteId),
          or(eq(agentRun.status, 'PENDING'), eq(agentRun.status, 'RUNNING')),
        ),
      );
    for (const run of staleRuns) {
      const [pendingAudit] = await this.platform.db
        .select({ id: auditEvent.id, occurredAt: auditEvent.occurredAt })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.agentRunId, run.id),
            eq(auditEvent.operation, 'agent.run'),
            or(eq(auditEvent.status, 'PENDING'), eq(auditEvent.status, 'RUNNING')),
          ),
        )
        .limit(1);
      if (pendingAudit) {
        try {
          await finishAuditEvent(this.platform.db, pendingAudit.id, {
            status: 'UNKNOWN',
            durationMs: run.startedAt
              ? Math.max(0, Date.now() - run.startedAt.getTime())
              : undefined,
            errorCode: 'AGENT_RUN_INTERRUPTED',
            resultSummary: { status: 'INTERRUPTED' },
          });
        } catch (error) {
          createLogger('website-agent.audit').error(
            {
              event: 'audit.finalization.failed',
              auditEventId: pendingAudit.id,
              outcome: 'unknown',
              ...serializeError(error),
            },
            'stale agent run audit finalization failed',
          );
        }
      }
    }
  }
}
