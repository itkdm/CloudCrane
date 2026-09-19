export type WorkspaceRuntimeStatus = 'created' | 'running' | 'stopped' | 'missing' | 'error';

export type WorkspaceRuntime = {
  workspaceId: string;
  status: WorkspaceRuntimeStatus;
  containerRef?: string;
  workspacePath?: string;
  endpoint?: string;
  previewPort?: number;
};

export type SnapshotStageInput = {
  artifactStorageKey: string;
  sourceWebsiteId: string;
  sourcePbootVersion: string;
  sourceCoreCommit: string;
  dbSchemaVersion: string;
};

export type SnapshotStageResult = {
  artifactStorageKey: string;
  artifactSha256: string;
  artifactSize: number;
  manifest: Record<string, unknown>;
};

export interface WorkspaceProvider {
  create(workspaceId: string): Promise<WorkspaceRuntime>;
  start(workspaceId: string): Promise<WorkspaceRuntime>;
  stop(workspaceId: string): Promise<WorkspaceRuntime>;
  getStatus(workspaceId: string): Promise<WorkspaceRuntime>;
  getEndpoint(workspaceId: string): Promise<string>;
  destroyRuntime(workspaceId: string): Promise<void>;
  stageSnapshot(workspaceId: string, input: SnapshotStageInput): Promise<SnapshotStageResult>;
}
