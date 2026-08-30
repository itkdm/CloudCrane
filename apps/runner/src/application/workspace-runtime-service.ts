import type { WorkspaceProvider, WorkspaceRuntime } from '../ports/workspace-provider.js';

export class WorkspaceRuntimeService {
  constructor(private readonly provider: WorkspaceProvider) {}
  create(workspaceId: string): Promise<WorkspaceRuntime> {
    return this.provider.create(workspaceId);
  }
  start(workspaceId: string): Promise<WorkspaceRuntime> {
    return this.provider.start(workspaceId);
  }
  stop(workspaceId: string): Promise<WorkspaceRuntime> {
    return this.provider.stop(workspaceId);
  }
  status(workspaceId: string): Promise<WorkspaceRuntime> {
    return this.provider.getStatus(workspaceId);
  }
  endpoint(workspaceId: string): Promise<string> {
    return this.provider.getEndpoint(workspaceId);
  }
  destroyRuntime(workspaceId: string): Promise<void> {
    return this.provider.destroyRuntime(workspaceId);
  }
}
