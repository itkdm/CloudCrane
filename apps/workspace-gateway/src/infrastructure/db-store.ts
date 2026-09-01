import { and, desc, eq, or } from 'drizzle-orm';
import type { PlatformDb } from '@cloudcrane/db';
import type { RunnerRegister } from '@cloudcrane/workspace-protocol';
import { runner, workspace } from '@cloudcrane/db';
import type {
  ControlPlaneStore,
  RunnerRecord,
  WorkspaceBinding,
} from '../ports/control-plane-store.js';

export class DrizzleControlPlaneStore implements ControlPlaneStore {
  constructor(private readonly platform: PlatformDb) {}
  async findWorkspace(workspaceId: string, websiteId: string): Promise<WorkspaceBinding | null> {
    const rows = await this.platform.db
      .select({
        workspaceId: workspace.id,
        websiteId: workspace.websiteId,
        runnerId: workspace.runnerId,
        status: workspace.status,
        containerRef: workspace.containerRef,
        workspacePath: workspace.workspacePath,
        previewPort: workspace.previewPort,
      })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), eq(workspace.websiteId, websiteId)))
      .limit(1);
    return rows[0] ?? null;
  }
  async registerRunner(register: RunnerRegister) {
    await this.platform.db
      .insert(runner)
      .values({
        id: register.runnerId,
        name: register.name,
        status: 'online',
        metadata: {
          version: register.version,
          capabilities: register.capabilities,
          region: register.region,
          ...register.metadata,
        },
      })
      .onConflictDoUpdate({
        target: runner.id,
        set: {
          name: register.name,
          status: 'online',
          metadata: {
            version: register.version,
            capabilities: register.capabilities,
            region: register.region,
            ...register.metadata,
          },
          updatedAt: new Date(),
        },
      });
  }
  async heartbeatRunner(runnerId: string, at: Date) {
    await this.platform.db
      .update(runner)
      .set({ status: 'online', lastHeartbeatAt: at, updatedAt: new Date() })
      .where(eq(runner.id, runnerId));
  }
  async setRunnerStatus(runnerId: string, status: string) {
    await this.platform.db
      .update(runner)
      .set({ status, updatedAt: new Date() })
      .where(eq(runner.id, runnerId));
  }
  async findAvailableRunner(capability: string): Promise<RunnerRecord | null> {
    const rows = await this.platform.db
      .select()
      .from(runner)
      .where(or(eq(runner.status, 'online'), eq(runner.status, 'available')))
      .orderBy(desc(runner.lastHeartbeatAt))
      .limit(32);
    const row = rows.find(
      (candidate) =>
        Array.isArray(candidate.metadata.capabilities) &&
        candidate.metadata.capabilities.includes(capability),
    );
    return row
      ? {
          runnerId: row.id,
          name: row.name,
          capabilities: (row.metadata.capabilities as string[]) ?? [],
          status: row.status,
          lastHeartbeatAt: row.lastHeartbeatAt ?? new Date(0),
        }
      : null;
  }
  async updateWorkspace(
    workspaceId: string,
    patch: Partial<
      Pick<
        WorkspaceBinding,
        'runnerId' | 'status' | 'containerRef' | 'workspacePath' | 'previewPort'
      >
    >,
  ) {
    await this.platform.db
      .update(workspace)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(workspace.id, workspaceId));
  }
}
