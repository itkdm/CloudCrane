import {
  isProductionMutationOperation,
  type ProductionClientOperation,
  type ProductionRunnerOperation,
} from '@cloudcrane/workspace-protocol';
import { createLogger, serializeError } from '@cloudcrane/shared';
import { GatewayRemoteError, remoteError } from '../errors.js';
import type { ControlPlaneStore } from '../ports/control-plane-store.js';
import { RunnerDispatchError, RunnerRegistry } from '../infrastructure/runner-registry.js';

export class ProductionDispatchService {
  private readonly logger = createLogger('workspace-gateway.production-audit');

  constructor(
    private readonly store: ControlPlaneStore,
    private readonly registry: RunnerRegistry,
  ) {}

  async execute(operation: ProductionClientOperation): Promise<unknown> {
    const startedAt = Date.now();
    const auditId = isProductionMutationOperation(operation.operation)
      ? await this.createAudit(operation)
      : undefined;
    let completed = false;
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

      const wire = {
        ...operation,
        type: 'production.operation' as const,
      } as ProductionRunnerOperation;
      const result = await this.registry.dispatch(runner.runnerId, wire);
      if (result.type === 'runner.error')
        throw new GatewayRemoteError(result.error, result.outcome === 'UNKNOWN' ? 504 : 502);
      if (result.type !== 'runner.completed')
        throw remoteError('PROTOCOL_ERROR', 'runner returned an incomplete result');
      completed = true;
      const auditFinalized = await this.finishAudit(auditId, {
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        resultSummary: cmsAuditSummary(operation, result.result),
      });
      if (!auditFinalized && isProductionMutationOperation(operation.operation))
        throw remoteError(
          'UNKNOWN_RESULT',
          'production operation completed but its audit result is unknown',
        );
      return result.result;
    } catch (error) {
      if (!completed) {
        const unknown =
          (error instanceof GatewayRemoteError && error.statusCode === 504) ||
          (error instanceof RunnerDispatchError &&
            error.accepted &&
            isProductionMutationOperation(operation.operation));
        await this.finishAudit(auditId, {
          status: unknown
            ? 'UNKNOWN'
            : error instanceof GatewayRemoteError && error.remote.code === 'REQUEST_TIMEOUT'
              ? 'TIMEOUT'
              : 'FAILED',
          durationMs: Date.now() - startedAt,
          errorCode: error instanceof GatewayRemoteError ? error.remote.code : undefined,
          resultSummary: cmsAuditSummary(operation),
        });
      }
      if (error instanceof GatewayRemoteError) throw error;
      if (error instanceof RunnerDispatchError)
        throw remoteError(error.code, error.message, { accepted: error.accepted });
      if (isProductionMutationOperation(operation.operation))
        throw remoteError('UNKNOWN_RESULT', 'production operation result is unknown');
      throw remoteError('INTERNAL_ERROR', 'production status could not be read');
    }
  }

  private async createAudit(operation: ProductionClientOperation): Promise<string | undefined> {
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
        { event: 'production.audit.creation.failed', ...serializeError(error) },
        'production operation audit could not be created',
      );
      throw remoteError('AUDIT_UNAVAILABLE', 'production operation audit is unavailable');
    }
  }

  private async finishAudit(
    auditId: string | undefined,
    input: {
      status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'UNKNOWN';
      durationMs: number;
      errorCode?: string;
      resultSummary?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    if (!auditId || !this.store.finishAuditEvent) return true;
    try {
      await this.store.finishAuditEvent(auditId, input);
      return true;
    } catch (error) {
      this.logger.error(
        {
          event: 'production.audit.finalization.failed',
          auditEventId: auditId,
          ...serializeError(error),
        },
        'production operation audit finalization failed',
      );
      return false;
    }
  }
}

function cmsAuditSummary(
  operation: ProductionClientOperation,
  result?: unknown,
): Record<string, unknown> | undefined {
  if (operation.operation === 'cms.media.upload') {
    const payload = operation.payload as { mimeType: string; contentSha256: string };
    return {
      action: operation.operation,
      mimeType: payload.mimeType,
      contentSha256: payload.contentSha256,
      ...(result && typeof result === 'object' && 'size' in result
        ? { size: (result as { size: unknown }).size }
        : {}),
    };
  }
  if (
    operation.operation !== 'cms.content.create' &&
    operation.operation !== 'cms.category.create' &&
    operation.operation !== 'cms.content.update' &&
    operation.operation !== 'cms.company.update'
  )
    return undefined;
  const payload = operation.payload as {
    patch: Record<string, unknown>;
    contentId?: string;
    categoryCode?: string;
    parentCode?: string;
  };
  const fields =
    operation.operation === 'cms.content.create' || operation.operation === 'cms.category.create'
      ? payload
      : payload.patch;
  const changedFields = Object.entries(fields)
    .filter(
      ([field]) =>
        field !== 'categoryCode' &&
        field !== 'parentCode' &&
        field !== 'contentId' &&
        field !== 'expectedVersion',
    )
    .flatMap(([field, value]) =>
      field === 'extensionFields' && value && typeof value === 'object'
        ? Object.keys(value).map((extensionField) => `extensionFields.${extensionField}`)
        : [field],
    )
    .join(',');
  return {
    action: operation.operation,
    ...(operation.operation === 'cms.content.create'
      ? {
          categoryCode: payload.categoryCode,
          recordId:
            typeof result === 'object' &&
            result &&
            'item' in result &&
            typeof result.item === 'object' &&
            result.item &&
            'id' in result.item
              ? result.item.id
              : undefined,
        }
      : operation.operation === 'cms.category.create'
        ? {
            parentCode: payload.parentCode,
            recordCode:
              typeof result === 'object' &&
              result &&
              'item' in result &&
              typeof result.item === 'object' &&
              result.item &&
              'scode' in result.item
                ? result.item.scode
                : undefined,
          }
        : {
            recordId: operation.operation === 'cms.content.update' ? payload.contentId : 'company',
          }),
    changedFields,
  };
}
