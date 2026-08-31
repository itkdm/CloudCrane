export type WorkspaceRuntimeStatus = 'created' | 'running' | 'stopped' | 'missing' | 'error';

export type WorkspaceRuntime = {
  workspaceId: string;
  status: WorkspaceRuntimeStatus;
  containerRef?: string;
  endpoint?: string;
  previewPort?: number;
};

export interface WorkspaceProvider {
  create(workspaceId: string): Promise<WorkspaceRuntime>;
  start(workspaceId: string): Promise<WorkspaceRuntime>;
  stop(workspaceId: string): Promise<WorkspaceRuntime>;
  getStatus(workspaceId: string): Promise<WorkspaceRuntime>;
  getEndpoint(workspaceId: string): Promise<string>;
  destroyRuntime(workspaceId: string): Promise<void>;
}
