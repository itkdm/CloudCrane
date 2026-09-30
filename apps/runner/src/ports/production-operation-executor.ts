import type {
  ProductionOperationName,
  ProductionRunnerOperation,
} from '@cloudcrane/workspace-protocol';

export interface ProductionOperationExecutor {
  supportedOperations(): readonly ProductionOperationName[];
  execute(operation: ProductionRunnerOperation): Promise<unknown>;
}
