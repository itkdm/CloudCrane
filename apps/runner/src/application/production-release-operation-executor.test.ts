import { productionRunnerOperationSchema } from '@cloudcrane/workspace-protocol';
import { describe, expect, it, vi } from 'vitest';
import { ProductionReleaseOperationExecutor } from './production-release-operation-executor.js';

describe('ProductionReleaseOperationExecutor', () => {
  it('advertises and dispatches release staging to the Workspace-bound stager', async () => {
    const stager = {
      stage: vi.fn().mockResolvedValue({ artifactStorageKey: 'release.zip' }),
    };
    const runtime = {
      ensureRuntime: vi.fn(),
      deployRelease: vi.fn(),
      status: vi.fn(),
      authorize: vi.fn(),
      destroyRuntime: vi.fn(),
    };
    const executor = new ProductionReleaseOperationExecutor(stager as never, runtime as never);
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

    expect(executor.supportedOperations()).toEqual([
      'release.stage',
      'production.ensure',
      'production.deploy',
      'production.status',
      'production.authorize',
      'production.destroy',
      'production.refresh',
      'cms.categories.list',
      'cms.content.list',
      'cms.content.get',
      'cms.content.create',
      'cms.content.update',
      'cms.company.get',
      'cms.company.update',
    ]);
    await expect(executor.execute(operation)).resolves.toEqual({
      artifactStorageKey: 'release.zip',
    });
    expect(stager.stage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      operation.payload,
    );
  });

  it('routes semantic CMS operations to the trusted production adapter', async () => {
    const runtime = {
      cmsOperation: vi.fn().mockResolvedValue({ items: [] }),
    };
    const executor = new ProductionReleaseOperationExecutor(
      { stage: vi.fn() } as never,
      runtime as never,
    );
    const operation = productionRunnerOperationSchema.parse({
      type: 'production.operation',
      operation: 'cms.categories.list',
      requestId: '00000000-0000-4000-8000-000000000011',
      traceId: '00000000-0000-4000-8000-000000000012',
      websiteId: '00000000-0000-4000-8000-000000000013',
      workspaceId: '00000000-0000-4000-8000-000000000014',
      deadlineMs: 120_000,
      payload: { limit: 5 },
    });

    await expect(executor.execute(operation)).resolves.toEqual({ items: [] });
    expect(runtime.cmsOperation).toHaveBeenCalledWith(operation.websiteId, {
      operation: 'cms.categories.list',
      payload: { limit: 5 },
    });
  });

  it('dispatches runtime ensure, deploy, status, and destroy through the production provider', async () => {
    const stager = { stage: vi.fn() };
    const runtime = {
      ensureRuntime: vi.fn().mockResolvedValue({
        websiteId: '00000000-0000-4000-8000-000000000003',
        status: 'provisioning',
        productionSlug: 'production-website',
        productionPort: 43127,
        containerRef: 'container-id',
      }),
      deployRelease: vi.fn().mockResolvedValue({
        websiteId: '00000000-0000-4000-8000-000000000003',
        status: 'authorization_required',
        productionSlug: 'production-website',
        productionPort: 43127,
        containerRef: 'container-id',
        currentReleaseId: '00000000-0000-4000-8000-000000000005',
      }),
      status: vi.fn().mockResolvedValue({
        websiteId: '00000000-0000-4000-8000-000000000003',
        status: 'missing',
        productionSlug: 'production-website',
        productionPort: null,
        containerRef: null,
        currentReleaseId: null,
        authorized: false,
      }),
      authorize: vi.fn().mockResolvedValue(undefined),
      destroyRuntime: vi.fn().mockResolvedValue(undefined),
    };
    const executor = new ProductionReleaseOperationExecutor(stager as never, runtime as never);
    const context = {
      type: 'production.operation' as const,
      requestId: '00000000-0000-4000-8000-000000000001',
      traceId: '00000000-0000-4000-8000-000000000002',
      websiteId: '00000000-0000-4000-8000-000000000003',
      workspaceId: '00000000-0000-4000-8000-000000000004',
      deadlineMs: 120_000,
    };

    const ensure = productionRunnerOperationSchema.parse({
      ...context,
      operation: 'production.ensure',
      payload: { productionSlug: 'production-website' },
    });
    await expect(executor.execute(ensure)).resolves.toMatchObject({
      websiteId: context.websiteId,
      productionPort: 43127,
    });

    const deployPayload = {
      releaseId: '00000000-0000-4000-8000-000000000005',
      productionSlug: 'production-website',
      sequence: 1,
      artifactStorageKey: 'release-00000000-0000-4000-8000-000000000005.zip',
      artifactSha256: 'a'.repeat(64),
      artifactSize: 1024,
      firstPublish: true,
    };
    const deploy = productionRunnerOperationSchema.parse({
      ...context,
      operation: 'production.deploy',
      payload: deployPayload,
    });
    await expect(executor.execute(deploy)).resolves.toMatchObject({
      releaseId: deployPayload.releaseId,
      status: 'authorization_required',
      sequence: 1,
    });
    expect(runtime.deployRelease).toHaveBeenCalledWith({
      websiteId: context.websiteId,
      releaseId: deployPayload.releaseId,
      productionSlug: 'production-website',
      artifactStorageKey: deployPayload.artifactStorageKey,
      artifactSha256: deployPayload.artifactSha256,
      artifactSize: deployPayload.artifactSize,
      firstPublish: true,
    });

    const status = productionRunnerOperationSchema.parse({
      ...context,
      operation: 'production.status',
      payload: { productionSlug: 'production-website' },
    });
    await expect(executor.execute(status)).resolves.toMatchObject({
      websiteId: context.websiteId,
      status: 'missing',
      authorized: false,
    });
    const destroy = productionRunnerOperationSchema.parse({
      ...context,
      operation: 'production.destroy',
      payload: { releaseIds: [] },
    });
    await expect(executor.execute(destroy)).resolves.toBeNull();
    const authorize = productionRunnerOperationSchema.parse({
      ...context,
      operation: 'production.authorize',
      payload: {
        productionSlug: 'production-website',
        authorizationCode: 'private-code',
      },
    });
    await expect(executor.execute(authorize)).resolves.toEqual({ status: 'active' });
    expect(runtime.ensureRuntime).toHaveBeenCalledWith(context.websiteId, 'production-website');
    expect(runtime.status).toHaveBeenCalledWith(context.websiteId, 'production-website');
    expect(runtime.destroyRuntime).toHaveBeenCalledWith(context.websiteId, []);
    expect(runtime.authorize).toHaveBeenCalledWith(
      context.websiteId,
      'production-website',
      'private-code',
    );
  });
});
