import { eq } from 'drizzle-orm';
import type { PlatformDb } from '@cloudcrane/db';
import { productionRuntime } from '@cloudcrane/db';

export type ProductionBinding = {
  websiteId: string;
  productionSlug: string;
  status: string;
  productionPort: number | null;
};

export interface ProductionBindingStore {
  findBySlug(productionSlug: string): Promise<ProductionBinding | null>;
}

export class DrizzleProductionBindingStore implements ProductionBindingStore {
  constructor(private readonly platform: PlatformDb) {}

  async findBySlug(productionSlug: string): Promise<ProductionBinding | null> {
    const rows = await this.platform.db
      .select({
        websiteId: productionRuntime.websiteId,
        productionSlug: productionRuntime.productionSlug,
        status: productionRuntime.status,
        productionPort: productionRuntime.productionPort,
      })
      .from(productionRuntime)
      .where(eq(productionRuntime.productionSlug, productionSlug))
      .limit(1);
    return rows[0] ?? null;
  }
}
