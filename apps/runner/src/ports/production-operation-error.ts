import type { RemoteError } from '@cloudcrane/workspace-protocol';

export type ProductionOperationErrorCode = Extract<
  RemoteError['code'],
  | 'WORKSPACE_CHANGED_DURING_PUBLISH'
  | 'PRODUCTION_STATE_CONFLICT'
  | 'PRODUCTION_HEALTHCHECK_FAILED'
  | 'PRODUCTION_RUNTIME_UNAVAILABLE'
  | 'PRODUCTION_CONTENT_CHANGED_DURING_SNAPSHOT'
  | 'WORKSPACE_SCHEMA_MISMATCH'
>;

export class ProductionOperationError extends Error {
  constructor(
    public readonly code: ProductionOperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionOperationError';
  }
}

export function toProductionRemoteError(error: unknown): RemoteError | undefined {
  if (!(error instanceof ProductionOperationError)) return undefined;
  return { code: error.code, message: error.message };
}
