import type {
  ProductionOperationName,
  RunnerRuntimeState,
  RunnerOperation,
  WorkspaceRunnerOperation,
} from '@cloudcrane/workspace-protocol';
import { createLogger, serializeError } from '@cloudcrane/shared';
import { WorkspaceDaemonClient } from '../daemon/workspace-daemon-client.js';
import { WorkspaceRuntimeService } from '../../application/workspace-runtime-service.js';
import type { WorkspaceRuntime } from '../../ports/workspace-provider.js';
import type { ProductionOperationExecutor } from '../../ports/production-operation-executor.js';

export class WorkspaceOperationHandler {
  private readonly logger = createLogger('runner.workspace-operation');

  constructor(
    private readonly runtime: WorkspaceRuntimeService,
    private readonly production?: ProductionOperationExecutor,
  ) {}

  productionCapabilities(): readonly ProductionOperationName[] {
    return this.production?.supportedOperations() ?? [];
  }

  async execute(operation: RunnerOperation): Promise<unknown> {
    if (operation.type === 'production.operation') {
      if (!this.production) throw new Error('production operation handler is unavailable');
      return this.production.execute(operation);
    }
    return this.executeWorkspace(operation);
  }

  async executeWithRuntimeState(
    operation: RunnerOperation,
  ): Promise<{ result: unknown; runtimeState?: RunnerRuntimeState }> {
    const startedAt = Date.now();
    const result = await this.execute(operation);
    if (operation.type === 'production.operation') return { result };

    if (operation.operation.startsWith('runtime.')) {
      return {
        result,
        ...(isRuntimeState(result) ? { runtimeState: toRunnerRuntimeState(result) } : {}),
      };
    }

    try {
      const remainingMs = operation.deadlineMs - (Date.now() - startedAt);
      if (remainingMs <= 0) return { result };
      const runtime = await withTimeout(this.runtime.status(operation.workspaceId), remainingMs);
      return { result, runtimeState: toRunnerRuntimeState(runtime) };
    } catch (error) {
      // State synchronization is best-effort and must not turn a completed workspace operation
      // into a failure. The control plane will retain its last known runtime state.
      this.logger.warn(
        {
          event: 'workspace.runtime.state.sync_failed',
          operation: operation.operation,
          workspaceId: operation.workspaceId,
          ...serializeError(error),
        },
        'workspace runtime state synchronization failed',
      );
      return { result };
    }
  }

  private async executeWorkspace(operation: WorkspaceRunnerOperation): Promise<unknown> {
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
      case 'snapshot.stage':
        return this.runtime.stageSnapshot(operation.workspaceId, operation.payload);
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

function isRuntimeState(value: unknown): value is {
  workspaceId: string;
  status: RunnerRuntimeState['status'];
  containerRef?: string;
  workspacePath?: string;
  previewPort?: number;
} {
  if (!value || typeof value !== 'object') return false;
  const runtime = value as Record<string, unknown>;
  return (
    typeof runtime.workspaceId === 'string' &&
    ['created', 'running', 'stopped', 'missing', 'error'].includes(String(runtime.status))
  );
}

function toRunnerRuntimeState(runtime: {
  workspaceId: string;
  status: RunnerRuntimeState['status'];
  containerRef?: string;
  workspacePath?: string;
  previewPort?: number;
}): RunnerRuntimeState {
  return {
    workspaceId: runtime.workspaceId,
    status: runtime.status,
    ...(runtime.containerRef ? { containerRef: runtime.containerRef } : {}),
    ...(runtime.workspacePath ? { workspacePath: runtime.workspacePath } : {}),
    ...(typeof runtime.previewPort === 'number' ? { previewPort: runtime.previewPort } : {}),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('runtime state synchronization timed out')),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
