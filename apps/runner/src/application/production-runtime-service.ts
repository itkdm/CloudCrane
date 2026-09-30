import type {
  ProductionDeployInput,
  ProductionProvider,
  ProductionRuntime,
} from '../ports/production-provider.js';

export class ProductionRuntimeService {
  constructor(private readonly provider: ProductionProvider) {}

  ensureRuntime(websiteId: string, productionSlug: string): Promise<ProductionRuntime> {
    return this.provider.ensureRuntime(websiteId, productionSlug);
  }

  deployRelease(input: ProductionDeployInput): Promise<ProductionRuntime> {
    return this.provider.deployRelease(input);
  }

  status(websiteId: string, productionSlug: string): Promise<ProductionRuntime> {
    return this.provider.getStatus(websiteId, productionSlug);
  }

  destroyRuntime(websiteId: string): Promise<void> {
    return this.provider.destroyRuntime(websiteId);
  }
}
