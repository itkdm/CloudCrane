export type ProductionRuntimeStatus =
  | 'provisioning'
  | 'activating'
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
  authorized: boolean;
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

export type ProductionContentSnapshot = {
  directory: string;
  databaseBytes: number;
  uploadFiles: number;
  uploadBytes: number;
};

export type CmsOperationInput = {
  operation:
    | 'cms.categories.list'
    | 'cms.content.list'
    | 'cms.content.get'
    | 'cms.content.create'
    | 'cms.content.update'
    | 'cms.company.get'
    | 'cms.company.update';
  payload: Record<string, unknown>;
  idempotencyKey?: string;
};

export interface ProductionProvider {
  ensureRuntime(websiteId: string, productionSlug: string): Promise<ProductionRuntime>;
  deployRelease(input: ProductionDeployInput): Promise<ProductionRuntime>;
  getStatus(websiteId: string, productionSlug: string): Promise<ProductionRuntime>;
  authorize(websiteId: string, productionSlug: string, authorizationCode: string): Promise<void>;
  destroyRuntime(websiteId: string, releaseIds: string[]): Promise<void>;
  snapshotContent(
    websiteId: string,
    productionSlug: string,
    refreshId: string,
  ): Promise<ProductionContentSnapshot>;
  removeContentSnapshot(snapshot: ProductionContentSnapshot, refreshId: string): Promise<void>;
  cmsOperation?(websiteId: string, input: CmsOperationInput): Promise<unknown>;
}
