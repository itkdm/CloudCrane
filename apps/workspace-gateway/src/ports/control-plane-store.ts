import type { RunnerRegister } from '@cloudcrane/workspace-protocol';
import type { AuditTerminalStatus } from '@cloudcrane/db';

export type WorkspaceBinding = {
  workspaceId: string;
  websiteId: string;
  runnerId: string | null;
  status: string;
  containerRef: string | null;
  workspacePath: string | null;
  previewPort: number | null;
};
export type RunnerRecord = {
  runnerId: string;
  name: string;
  capabilities: string[];
  status: string;
  lastHeartbeatAt: Date;
};

export interface ControlPlaneStore {
  createAuditEvent?(input: {
    operation: string;
    requestId: string;
    runCorrelationId: string;
    websiteId: string;
    workspaceId: string;
    agentRunId?: string;
    toolCallId?: string;
    idempotencyKey?: string;
  }): Promise<string>;
  finishAuditEvent?(
    id: string,
    input: { status: AuditTerminalStatus; durationMs?: number; errorCode?: string },
  ): Promise<void>;
  findWorkspace(workspaceId: string, websiteId: string): Promise<WorkspaceBinding | null>;
  registerRunner(register: RunnerRegister): Promise<void>;
  heartbeatRunner(runnerId: string, at: Date): Promise<void>;
  setRunnerStatus(runnerId: string, status: string): Promise<void>;
  findAvailableRunner(capability: string): Promise<RunnerRecord | null>;
  updateWorkspace(
    workspaceId: string,
    patch: Partial<
      Pick<
        WorkspaceBinding,
        'runnerId' | 'status' | 'containerRef' | 'workspacePath' | 'previewPort'
      >
    >,
  ): Promise<void>;
}
