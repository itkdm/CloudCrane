export type ProductionRuntimeStatus =
  | 'provisioning'
  | 'authorization_required'
  | 'active'
  | 'failed'
  | 'stopped'
  | 'deleting'
  | 'missing';

export type ProductionRuntime = {
  websiteId: string;
  status: ProductionRuntimeStatus;
  productionSlug: string;
  productionPort: number | null;
  containerRef: string | null;
  currentReleaseId: string | null;
};

export type ProductionDeployInput = {
  websiteId: string;
  releaseId: string;
  productionSlug: string;
  artifactStorageKey: string;
  artifactSha256: string;
  artifactSize: number;
  firstPublish: boolean;
};

export interface ProductionProvider {
  ensureRuntime(websiteId: string, productionSlug: string): Promise<ProductionRuntime>;
  deployRelease(input: ProductionDeployInput): Promise<ProductionRuntime>;
  getStatus(websiteId: string, productionSlug: string): Promise<ProductionRuntime>;
  authorize(websiteId: string, productionSlug: string, authorizationCode: string): Promise<void>;
  destroyRuntime(websiteId: string): Promise<void>;
}
