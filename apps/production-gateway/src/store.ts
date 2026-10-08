import { eq } from 'drizzle-orm';
import type { PlatformDb } from '@cloudcrane/db';
import { productionDomain, productionRuntime } from '@cloudcrane/db';

export type ProductionBinding = {
  websiteId: string;
  productionSlug: string;
  status: string;
  productionPort: number | null;
  redirectUrl?: string;
};

export interface ProductionBindingStore {
  findBySlug(productionSlug: string): Promise<ProductionBinding | null>;
}

export class DrizzleProductionBindingStore implements ProductionBindingStore {
  constructor(
    private readonly platform: PlatformDb,
    private readonly hostSuffix: string,
    private readonly publicProtocol: 'http' | 'https',
  ) {}

  async findBySlug(productionSlug: string): Promise<ProductionBinding | null> {
    const rows = await this.platform.db
      .select({
        websiteId: productionRuntime.websiteId,
        productionSlug: productionRuntime.productionSlug,
        status: productionRuntime.status,
        productionPort: productionRuntime.productionPort,
        routeType: productionDomain.routeType,
      })
      .from(productionDomain)
      .innerJoin(productionRuntime, eq(productionDomain.productionRuntimeId, productionRuntime.id))
      .where(eq(productionDomain.slug, productionSlug))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.routeType === 'redirect') {
      return {
        ...row,
        redirectUrl: `${this.publicProtocol}://${row.productionSlug}.${this.hostSuffix}/`,
      };
    }
    return row;
  }
}
