import { describe, expect, it } from 'vitest';
import { remoteErrorSchema } from '@cloudcrane/workspace-protocol';
import { ProductionOperationError, toProductionRemoteError } from './production-operation-error.js';

describe('production operation errors', () => {
  it('preserves an allowlisted production error code across the Runner boundary', () => {
    const error = new ProductionOperationError(
      'WORKSPACE_CHANGED_DURING_PUBLISH',
      'Workspace changed while the release was being staged',
    );

    expect(remoteErrorSchema.safeParse(toProductionRemoteError(error)).success).toBe(true);
    expect(toProductionRemoteError(error)).toEqual({
      code: 'WORKSPACE_CHANGED_DURING_PUBLISH',
      message: 'Workspace changed while the release was being staged',
    });
  });

  it('does not map unrelated errors to production error codes', () => {
    expect(toProductionRemoteError(new Error('internal'))).toBeUndefined();
  });
});
