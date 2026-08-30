import type { RunnerOperation } from '@cloudcrane/workspace-protocol';
import { WorkspaceDaemonClient } from '../daemon/workspace-daemon-client.js';
import { WorkspaceRuntimeService } from '../../application/workspace-runtime-service.js';
import type { WorkspaceRuntime } from '../../ports/workspace-provider.js';

export class WorkspaceOperationHandler {
  constructor(private readonly runtime: WorkspaceRuntimeService) {}

  async execute(operation: RunnerOperation): Promise<unknown> {
    const deadlineAt = Date.now() + operation.deadlineMs;
    switch (operation.operation) {
      case 'runtime.create':
        return this.waitForDaemon(await this.runtime.create(operation.workspaceId), deadlineAt);
      case 'runtime.start':
        return this.waitForDaemon(await this.runtime.start(operation.workspaceId), deadlineAt);
      case 'runtime.stop':
        return this.runtime.stop(operation.workspaceId);
      case 'runtime.status':
        return this.runtime.status(operation.workspaceId);
      case 'runtime.destroy':
        await this.runtime.destroyRuntime(operation.workspaceId);
        return null;
      case 'runtime.info':
        return (await this.daemon(operation.workspaceId, deadlineAt)).runtimeInfo();
      case 'fs.read':
        return (await this.daemon(operation.workspaceId, deadlineAt)).read(operation.payload);
      case 'fs.write':
        return (await this.daemon(operation.workspaceId, deadlineAt)).write(operation.payload);
      case 'fs.stat':
        return (await this.daemon(operation.workspaceId, deadlineAt)).stat(operation.payload);
      case 'fs.list':
        return (await this.daemon(operation.workspaceId, deadlineAt)).list(operation.payload);
      case 'fs.mkdir':
        return (await this.daemon(operation.workspaceId, deadlineAt)).mkdir(operation.payload);
      case 'process.exec':
        return (await this.daemon(operation.workspaceId, deadlineAt)).exec(
          operation.payload,
          this.remaining(deadlineAt),
        );
      case 'process.cancel':
        return (await this.daemon(operation.workspaceId, deadlineAt)).cancel(
          operation.payload.executionId,
        );
    }
  }

  private async daemon(workspaceId: string, deadlineMs: number) {
    return new WorkspaceDaemonClient(
      await this.runtime.endpoint(workspaceId),
      this.remaining(deadlineMs),
    );
  }

  private async waitForDaemon(runtime: WorkspaceRuntime, deadlineMs: number) {
    if (!runtime.endpoint) return runtime;
    const client = new WorkspaceDaemonClient(runtime.endpoint, this.remaining(deadlineMs));
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await client.health();
        return runtime;
      } catch {
        const delay = Math.min(250, Math.max(0, this.remaining(deadlineMs)));
        if (delay === 0) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      }
    }
    throw new Error('workspace daemon did not become ready');
  }

  private remaining(deadlineAt: number) {
    return Math.max(1, deadlineAt - Date.now());
  }
}
