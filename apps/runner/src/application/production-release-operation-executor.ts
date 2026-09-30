import type {
  ProductionOperationName,
  ProductionRunnerOperation,
} from '@cloudcrane/workspace-protocol';
import type { ProductionOperationExecutor } from '../ports/production-operation-executor.js';
import type { ProductionRuntimeService } from './production-runtime-service.js';
import { ProductionReleaseStager } from './production-release-stager.js';

export class ProductionReleaseOperationExecutor implements ProductionOperationExecutor {
  constructor(
    private readonly stager: ProductionReleaseStager,
    private readonly runtime: ProductionRuntimeService,
  ) {}

  supportedOperations(): readonly ProductionOperationName[] {
    return [
      'release.stage',
      'production.ensure',
      'production.deploy',
      'production.status',
      'production.authorize',
      'production.destroy',
    ];
  }

  async execute(operation: ProductionRunnerOperation): Promise<unknown> {
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
          authorized: runtime.status === 'active',
        };
      }
      case 'production.destroy':
        await this.runtime.destroyRuntime(operation.websiteId);
        return null;
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
