import { productionRunnerOperationSchema } from '@cloudcrane/workspace-protocol';
import { describe, expect, it, vi } from 'vitest';
import { ProductionReleaseOperationExecutor } from './production-release-operation-executor.js';

describe('ProductionReleaseOperationExecutor', () => {
  it('advertises and dispatches release staging to the Workspace-bound stager', async () => {
    const stager = {
      stage: vi.fn().mockResolvedValue({ artifactStorageKey: 'release.zip' }),
    };
    const executor = new ProductionReleaseOperationExecutor(stager as never);
    const operation = productionRunnerOperationSchema.parse({
      type: 'production.operation',
      operation: 'release.stage',
      requestId: '00000000-0000-4000-8000-000000000001',
      traceId: '00000000-0000-4000-8000-000000000002',
      websiteId: '00000000-0000-4000-8000-000000000003',
      workspaceId: '00000000-0000-4000-8000-000000000004',
      deadlineMs: 120_000,
      payload: {
        artifactStorageKey: 'release-00000000-0000-4000-8000-000000000005.zip',
        releaseId: '00000000-0000-4000-8000-000000000005',
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea',
        firstPublish: true,
      },
    });

    expect(executor.supportedOperations()).toEqual(['release.stage']);
    await expect(executor.execute(operation)).resolves.toEqual({
      artifactStorageKey: 'release.zip',
    });
    expect(stager.stage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      operation.payload,
    );
  });
});
