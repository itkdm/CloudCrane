import {
  gatewayOperationSchema,
  isMutationOperation,
  type ClientOperation,
  type RunnerOperation,
  type RunnerRuntimeState,
} from '@cloudcrane/workspace-protocol';
import { GatewayRemoteError, remoteError } from '../errors.js';
import type { ControlPlaneStore, WorkspaceBinding } from '../ports/control-plane-store.js';
import { RunnerDispatchError, RunnerRegistry } from '../infrastructure/runner-registry.js';
import { createLogger, injectTraceparent, serializeError, withSpan } from '@cloudcrane/shared';

export class WorkspaceDispatchService {
  private readonly logger = createLogger('workspace-gateway.audit');
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly registry: RunnerRegistry,
  ) {}

  async execute(operation: ClientOperation): Promise<unknown> {
    return withSpan(
      'workspace.operation',
      {
        'cloudcrane.operation': operation.operation,
        'cloudcrane.website_id': operation.websiteId,
        'cloudcrane.workspace_id': operation.workspaceId,
        'cloudcrane.agent_run_id': operation.agentRunId,
      },
      () => {
        const headers: Record<string, string> = {};
        injectTraceparent(headers);
        return this.executeInternal({
          ...operation,
          traceparent: headers.traceparent ?? operation.traceparent,
        });
      },
    );
  }

  private async executeInternal(operation: ClientOperation): Promise<unknown> {
    const startedAt = Date.now();
    const auditId = isMutationOperation(operation.operation)
      ? await this.createAudit(operation)
      : undefined;
    let operationCompleted = false;
    try {
      const binding = await this.store.findWorkspace(operation.workspaceId, operation.websiteId);
      if (!binding)
        throw remoteError('WEBSITE_WORKSPACE_MISMATCH', 'workspace is not owned by website');
      const capability = operation.operation;
      const bound = binding.runnerId ? this.registry.get(binding.runnerId) : undefined;
      const runner = bound
        ? { runnerId: binding.runnerId!, capabilities: bound.register.capabilities }
        : await this.store.findAvailableRunner(capability);
      if (!runner || !this.registry.online(runner.runnerId))
        throw remoteError('RUNNER_UNAVAILABLE', 'no online runner is available');
      if (runner.capabilities.length && !runner.capabilities.includes(capability))
        throw remoteError('RUNNER_CAPABILITY_MISSING', `runner does not support ${capability}`);
      const wire = gatewayOperationSchema.parse({
        ...operation,
        type: 'workspace.operation',
      }) as RunnerOperation;
      const result = await this.registry.dispatch(runner.runnerId, wire);
      if (result.type === 'runner.error')
        throw new GatewayRemoteError(result.error, result.outcome === 'UNKNOWN' ? 504 : 502);
      if (result.type !== 'runner.completed')
        throw remoteError('PROTOCOL_ERROR', 'runner returned an incomplete result');
      await this.updateState(
        operation,
        result.result,
        runner.runnerId,
        binding,
        result.runtimeState,
      );
      operationCompleted = true;
      const auditFinalized = await this.finishAudit(auditId, {
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
      });
      if (!auditFinalized && isMutationOperation(operation.operation)) {
        throw remoteError(
          'UNKNOWN_RESULT',
          'workspace mutation completed but its audit record could not be finalized',
        );
      }
      return this.publicResult(operation, result.result);
    } catch (error) {
      if (!operationCompleted)
        await this.finishAudit(auditId, {
          status:
            error instanceof GatewayRemoteError && error.statusCode === 504
              ? 'UNKNOWN'
              : error instanceof GatewayRemoteError && error.remote.code === 'REQUEST_TIMEOUT'
                ? 'TIMEOUT'
                : error instanceof RunnerDispatchError &&
                    isMutationOperation(operation.operation) &&
                    error.accepted
                  ? 'UNKNOWN'
                  : 'FAILED',
          durationMs: Date.now() - startedAt,
          errorCode: error instanceof GatewayRemoteError ? error.remote.code : undefined,
        });
      if (error instanceof GatewayRemoteError) throw error;
      if (error instanceof RunnerDispatchError)
        throw remoteError(error.code, error.message, { accepted: error.accepted });
      const unknown = isMutationOperation(operation.operation);
      throw remoteError(
        unknown ? 'UNKNOWN_RESULT' : 'REQUEST_TIMEOUT',
        unknown
          ? 'runner connection ended before mutation result was known'
          : 'runner did not complete the read operation',
      );
    }
  }

  private async createAudit(operation: ClientOperation): Promise<string | undefined> {
    if (!this.store.createAuditEvent) return undefined;
    try {
      return await this.store.createAuditEvent({
        operation: operation.operation,
        requestId: operation.requestId,
        runCorrelationId: operation.traceId,
        websiteId: operation.websiteId,
        workspaceId: operation.workspaceId,
        agentRunId: operation.agentRunId,
        toolCallId: operation.toolCallId,
        idempotencyKey: operation.idempotencyKey,
      });
    } catch (error) {
      this.logger.error(
        {
          event: 'audit.creation.failed',
          operation: operation.operation,
          ...serializeError(error),
        },
        'audit event creation failed',
      );
      if (isMutationOperation(operation.operation))
        throw remoteError('AUDIT_UNAVAILABLE', 'workspace mutation audit is unavailable');
      return undefined;
    }
  }

  private async finishAudit(
    auditId: string | undefined,
    input: {
      status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'UNKNOWN';
      durationMs: number;
      errorCode?: string;
    },
  ): Promise<boolean> {
    if (!auditId || !this.store.finishAuditEvent) return true;
    try {
      await this.store.finishAuditEvent(auditId, input);
      return true;
    } catch (error) {
      this.logger.error(
        { event: 'audit.finalization.failed', auditEventId: auditId, ...serializeError(error) },
        'audit event finalization failed',
      );
      return false;
    }
  }

  private async updateState(
    operation: ClientOperation,
    result: unknown,
    runnerId: string,
    binding: WorkspaceBinding,
    runtimeState?: RunnerRuntimeState,
  ) {
    if (!operation.operation.startsWith('runtime.')) {
      if (runtimeState) {
        await this.persistRuntimeState(operation.workspaceId, binding, runtimeState);
      }
      return;
    }
    const runtime =
      typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {};
    if (operation.operation === 'runtime.create')
      await this.store.updateWorkspace(operation.workspaceId, {
        runnerId,
        status: String(runtime.status ?? 'created'),
        containerRef: typeof runtime.containerRef === 'string' ? runtime.containerRef : null,
        workspacePath: typeof runtime.workspacePath === 'string' ? runtime.workspacePath : null,
        previewPort: typeof runtime.previewPort === 'number' ? runtime.previewPort : null,
      });
    if (
      operation.operation === 'runtime.start' ||
      operation.operation === 'runtime.stop' ||
      operation.operation === 'runtime.status'
    ) {
      const status = runtime.status;
      if (!isRuntimeStatus(status))
        throw remoteError('PROTOCOL_ERROR', 'runner returned an invalid runtime status');
      await this.persistRuntimeState(operation.workspaceId, binding, {
        workspaceId: operation.workspaceId,
        status,
        ...(typeof runtime.containerRef === 'string' ? { containerRef: runtime.containerRef } : {}),
        ...(typeof runtime.workspacePath === 'string'
          ? { workspacePath: runtime.workspacePath }
          : {}),
        ...(typeof runtime.previewPort === 'number' ? { previewPort: runtime.previewPort } : {}),
      });
    }
    if (operation.operation === 'runtime.destroy')
      await this.store.updateWorkspace(operation.workspaceId, {
        runnerId: null,
        status: 'missing',
        containerRef: null,
        workspacePath: null,
        previewPort: null,
      });
  }

  private async persistRuntimeState(
    workspaceId: string,
    binding: WorkspaceBinding,
    runtime: RunnerRuntimeState,
  ) {
    if (runtime.workspaceId !== workspaceId) {
      this.logger.warn(
        {
          event: 'workspace.runtime.state.mismatch',
          workspaceId,
          reportedWorkspaceId: runtime.workspaceId,
        },
        'ignored runtime state for a different workspace',
      );
      return;
    }
    const patch: Parameters<ControlPlaneStore['updateWorkspace']>[1] = {
      status: runtime.status,
      ...(runtime.containerRef !== undefined ? { containerRef: runtime.containerRef } : {}),
      ...(runtime.workspacePath !== undefined ? { workspacePath: runtime.workspacePath } : {}),
      previewPort: runtime.status === 'running' ? (runtime.previewPort ?? null) : null,
    };
    const changed =
      binding.status !== patch.status ||
      (patch.containerRef !== undefined && binding.containerRef !== patch.containerRef) ||
      (patch.workspacePath !== undefined && binding.workspacePath !== patch.workspacePath) ||
      binding.previewPort !== patch.previewPort;
    if (changed) await this.store.updateWorkspace(workspaceId, patch);
  }

  private publicResult(operation: ClientOperation, result: unknown): unknown {
    if (
      operation.operation === 'runtime.create' ||
      operation.operation === 'runtime.start' ||
      operation.operation === 'runtime.stop' ||
      operation.operation === 'runtime.status'
    ) {
      const value = result as Record<string, unknown>;
      return { workspaceId: operation.workspaceId, status: value.status };
    }
    if (operation.operation === 'runtime.destroy') return null;
    return result;
  }
}

function isRuntimeStatus(value: unknown): value is RunnerRuntimeState['status'] {
  return ['created', 'running', 'stopped', 'missing', 'error'].includes(String(value));
}
