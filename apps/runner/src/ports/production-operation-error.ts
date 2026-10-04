import type { RemoteError } from '@cloudcrane/workspace-protocol';

export type ProductionOperationErrorCode = Extract<
  RemoteError['code'],
  | 'WORKSPACE_CHANGED_DURING_PUBLISH'
  | 'PRODUCTION_STATE_CONFLICT'
  | 'PRODUCTION_HEALTHCHECK_FAILED'
  | 'PRODUCTION_RUNTIME_UNAVAILABLE'
  | 'PRODUCTION_CONTENT_CHANGED_DURING_SNAPSHOT'
  | 'WORKSPACE_SCHEMA_MISMATCH'
  | 'CMS_NOT_AVAILABLE'
  | 'CMS_PRODUCTION_NOT_ACTIVE'
  | 'CMS_AUTHORIZATION_REQUIRED'
  | 'CMS_CONTENT_NOT_FOUND'
  | 'CMS_CONTENT_CHANGED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CMS_CREATE_RESULT_UNAVAILABLE'
  | 'CMS_CATEGORY_CREATE_RESULT_UNAVAILABLE'
  | 'CMS_MEDIA_RESULT_UNAVAILABLE'
  | 'CMS_INVALID_FIELD'
  | 'CMS_INVALID_VALUE'
  | 'CMS_SCHEMA_UNSUPPORTED'
  | 'CMS_OPERATION_FAILED'
  | 'UNKNOWN_RESULT'
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
