import type {
  ProductionOperationName,
  ProductionRunnerOperation,
} from '@cloudcrane/workspace-protocol';
import type { ProductionOperationExecutor } from '../ports/production-operation-executor.js';
import { ProductionReleaseStager } from './production-release-stager.js';

export class ProductionReleaseOperationExecutor implements ProductionOperationExecutor {
  constructor(private readonly stager: ProductionReleaseStager) {}

  supportedOperations(): readonly ProductionOperationName[] {
    return ['release.stage'];
  }

  execute(operation: ProductionRunnerOperation): Promise<unknown> {
    if (operation.operation !== 'release.stage')
      throw new Error('production operation is not supported by this Runner');
    return this.stager.stage(operation.websiteId, operation.workspaceId, operation.payload);
  }
}
