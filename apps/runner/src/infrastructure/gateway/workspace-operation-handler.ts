import type { RunnerOperation } from '@cloudcrane/workspace-protocol';
import { WorkspaceDaemonClient } from '../daemon/workspace-daemon-client.js';
import { WorkspaceRuntimeService } from '../../application/workspace-runtime-service.js';

export class WorkspaceOperationHandler {
  constructor(private readonly runtime: WorkspaceRuntimeService) {}

  async execute(operation: RunnerOperation): Promise<unknown> {
    switch (operation.operation) {
      case 'runtime.create':
        return this.runtime.create(operation.workspaceId);
      case 'runtime.start':
        return this.runtime.start(operation.workspaceId);
      case 'runtime.stop':
        return this.runtime.stop(operation.workspaceId);
      case 'runtime.status':
        return this.runtime.status(operation.workspaceId);
      case 'runtime.destroy':
        await this.runtime.destroyRuntime(operation.workspaceId);
        return null;
      case 'runtime.info':
        return (await this.daemon(operation.workspaceId)).runtimeInfo();
      case 'fs.read':
        return (await this.daemon(operation.workspaceId)).read(operation.payload);
      case 'fs.write':
        return (await this.daemon(operation.workspaceId)).write(operation.payload);
      case 'fs.stat':
        return (await this.daemon(operation.workspaceId)).stat(operation.payload);
      case 'fs.list':
        return (await this.daemon(operation.workspaceId)).list(operation.payload);
      case 'fs.mkdir':
        return (await this.daemon(operation.workspaceId)).mkdir(operation.payload);
      case 'process.exec':
        return (await this.daemon(operation.workspaceId)).exec(operation.payload);
      case 'process.cancel':
        return (await this.daemon(operation.workspaceId)).cancel(operation.payload.executionId);
    }
  }

  private async daemon(workspaceId: string) {
    return new WorkspaceDaemonClient(await this.runtime.endpoint(workspaceId));
  }
}
