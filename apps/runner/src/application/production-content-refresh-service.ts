import { createLogger } from '@cloudcrane/shared';
import type { ProductionRuntimeService } from './production-runtime-service.js';
import type { WorkspaceRuntimeService } from './workspace-runtime-service.js';

const logger = createLogger('runner-production-refresh');

export class ProductionContentRefreshService {
  constructor(
    private readonly production: ProductionRuntimeService,
    private readonly workspace: WorkspaceRuntimeService,
  ) {}

  async refresh(input: {
    websiteId: string;
    workspaceId: string;
    productionSlug: string;
    refreshId: string;
  }) {
    const snapshot = await this.production.snapshotContent(
      input.websiteId,
      input.productionSlug,
      input.refreshId,
    );
    try {
      return await this.workspace.importProductionContent(input.workspaceId, {
        refreshId: input.refreshId,
        snapshotDirectory: snapshot.directory,
      });
    } finally {
      await this.production.removeContentSnapshot(snapshot, input.refreshId).catch((error) => {
        logger.warn(
          {
            event: 'production.content-refresh.snapshot-cleanup.failed',
            websiteId: input.websiteId,
            workspaceId: input.workspaceId,
            refreshId: input.refreshId,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          },
          'Production refresh snapshot cleanup failed',
        );
      });
    }
  }
}
