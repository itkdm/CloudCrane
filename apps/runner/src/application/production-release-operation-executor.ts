import type {
  ProductionOperationName,
  ProductionRunnerOperation,
} from '@cloudcrane/workspace-protocol';
import type { ProductionOperationExecutor } from '../ports/production-operation-executor.js';
import type { ProductionRuntimeService } from './production-runtime-service.js';
import type { ProductionContentRefreshService } from './production-content-refresh-service.js';
import { ProductionReleaseStager } from './production-release-stager.js';

export class ProductionReleaseOperationExecutor implements ProductionOperationExecutor {
  private readonly websiteLocks = new Map<string, Promise<void>>();
  constructor(
    private readonly stager: ProductionReleaseStager,
    private readonly runtime: ProductionRuntimeService,
    private readonly contentRefresh?: ProductionContentRefreshService,
  ) {}

  supportedOperations(): readonly ProductionOperationName[] {
    return [
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
      'cms.media.upload',
      'cms.content.create',
      'cms.content.update',
      'cms.company.get',
      'cms.company.update',
    ];
  }

  async execute(operation: ProductionRunnerOperation): Promise<unknown> {
    const previous = this.websiteLocks.get(operation.websiteId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.websiteLocks.set(operation.websiteId, current);
    await previous;
    try {
      return await this.executeLocked(operation);
    } finally {
      release();
      if (this.websiteLocks.get(operation.websiteId) === current)
        this.websiteLocks.delete(operation.websiteId);
    }
  }

  private async executeLocked(operation: ProductionRunnerOperation): Promise<unknown> {
    switch (operation.operation) {
      case 'release.stage':
        return this.stager.stage(operation.websiteId, operation.workspaceId, operation.payload);
      case 'production.ensure': {
        const runtime = await this.runtime.ensureRuntime(
          operation.websiteId,
          operation.payload.productionSlug,
        );
        if (!runtime.productionPort || !runtime.containerRef)
          throw new Error('PRODUCTION_RUNTIME_INCOMPLETE');
        return {
          websiteId: runtime.websiteId,
          status: runtime.status,
          productionSlug: runtime.productionSlug,
          productionPort: runtime.productionPort,
          containerRef: runtime.containerRef,
        };
      }
      case 'production.deploy': {
        const runtime = await this.runtime.deployRelease({
          websiteId: operation.websiteId,
          releaseId: operation.payload.releaseId,
          productionSlug: operation.payload.productionSlug,
          artifactStorageKey: operation.payload.artifactStorageKey,
          artifactSha256: operation.payload.artifactSha256,
          artifactSize: operation.payload.artifactSize,
          firstPublish: operation.payload.firstPublish,
        });
        if (!runtime.productionPort || !runtime.containerRef || !runtime.currentReleaseId)
          throw new Error('PRODUCTION_RUNTIME_INCOMPLETE');
        return {
          releaseId: runtime.currentReleaseId,
          productionSlug: runtime.productionSlug,
          sequence: operation.payload.sequence,
          status: runtime.status === 'active' ? 'active' : 'authorization_required',
          activatedAt: new Date().toISOString(),
        };
      }
      case 'production.status': {
        const runtime = await this.runtime.status(
          operation.websiteId,
          operation.payload.productionSlug,
        );
        return {
          websiteId: runtime.websiteId,
          status: runtime.status,
          productionSlug: runtime.productionSlug,
          productionPort: runtime.productionPort,
          currentReleaseId: runtime.currentReleaseId,
          authorized: runtime.authorized,
        };
      }
      case 'production.destroy':
        await this.runtime.destroyRuntime(operation.websiteId, operation.payload.releaseIds);
        return null;
      case 'production.refresh':
        if (!this.contentRefresh) throw new Error('production content refresh is unavailable');
        return this.contentRefresh.refresh({
          websiteId: operation.websiteId,
          workspaceId: operation.workspaceId,
          productionSlug: operation.payload.productionSlug,
          refreshId: operation.payload.refreshId,
        });
      case 'cms.categories.list':
      case 'cms.content.list':
      case 'cms.content.get':
      case 'cms.media.upload':
      case 'cms.content.create':
      case 'cms.content.update':
      case 'cms.company.get':
      case 'cms.company.update': {
        return this.runtime.cmsOperation(operation.websiteId, {
          operation: operation.operation,
          payload: operation.payload,
          idempotencyKey: operation.idempotencyKey,
        });
      }
      case 'production.authorize':
        await this.runtime.authorize(
          operation.websiteId,
          operation.payload.productionSlug,
          operation.payload.authorizationCode,
        );
        return { status: 'active' };
    }
  }
}
