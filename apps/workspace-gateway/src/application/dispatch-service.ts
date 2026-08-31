import {
  gatewayOperationSchema,
  isMutationOperation,
  type ClientOperation,
  type RunnerOperation,
} from '@cloudcrane/workspace-protocol';
import { GatewayRemoteError, remoteError } from '../errors.js';
import type { ControlPlaneStore } from '../ports/control-plane-store.js';
import { RunnerDispatchError, RunnerRegistry } from '../infrastructure/runner-registry.js';

export class WorkspaceDispatchService {
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly registry: RunnerRegistry,
  ) {}

  async execute(operation: ClientOperation): Promise<unknown> {
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
    try {
      const result = await this.registry.dispatch(runner.runnerId, wire);
      if (result.type === 'runner.error')
        throw new GatewayRemoteError(result.error, result.outcome === 'UNKNOWN' ? 504 : 502);
      if (result.type !== 'runner.completed')
        throw remoteError('PROTOCOL_ERROR', 'runner returned an incomplete result');
      await this.updateState(operation, result.result, runner.runnerId);
      return this.publicResult(operation, result.result);
    } catch (error) {
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

  private async updateState(operation: ClientOperation, result: unknown, runnerId: string) {
    if (!operation.operation.startsWith('runtime.')) return;
    const runtime =
      typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {};
    if (operation.operation === 'runtime.create')
      await this.store.updateWorkspace(operation.workspaceId, {
        runnerId,
        status: String(runtime.status ?? 'created'),
        containerRef: typeof runtime.containerRef === 'string' ? runtime.containerRef : null,
        previewPort: typeof runtime.previewPort === 'number' ? runtime.previewPort : null,
      });
    if (
      operation.operation === 'runtime.start' ||
      operation.operation === 'runtime.stop' ||
      operation.operation === 'runtime.status'
    )
      await this.store.updateWorkspace(operation.workspaceId, {
        status: String(runtime.status ?? 'unknown'),
        ...((operation.operation === 'runtime.start' ||
          (operation.operation === 'runtime.status' && runtime.status === 'running')) &&
        typeof runtime.previewPort === 'number'
          ? { previewPort: runtime.previewPort }
          : operation.operation === 'runtime.stop' ||
              (operation.operation === 'runtime.status' && runtime.status !== 'running')
            ? { previewPort: null }
            : {}),
      });
    if (operation.operation === 'runtime.destroy')
      await this.store.updateWorkspace(operation.workspaceId, {
        runnerId: null,
        status: 'missing',
        containerRef: null,
        previewPort: null,
      });
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
