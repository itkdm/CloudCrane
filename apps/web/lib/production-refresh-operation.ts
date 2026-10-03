export type ProductionRefreshStatus =
  | 'processing'
  | 'pending'
  | 'running'
  | 'retryable'
  | 'succeeded'
  | 'failed'
  | 'not_found'
  | 'idle';

export type ProductionRefreshOperationStatus = {
  operationId?: string;
  status: ProductionRefreshStatus;
  result?: { databaseBytes?: number; uploadFiles?: number; uploadBytes?: number } | null;
  previewSynchronized?: boolean | null;
  errorCode?: string | null;
};

export function productionRefreshStatusUrl(websiteId: string, idempotencyKey: string): string {
  const query = new URLSearchParams({ idempotencyKey });
  return `/api/websites/${encodeURIComponent(websiteId)}/production/refresh?${query.toString()}`;
}

export function isProductionRefreshInFlight(status: string | undefined): boolean {
  return ['processing', 'pending', 'running', 'retryable'].includes(status ?? '');
}

export async function getProductionRefreshOperation(
  websiteId: string,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProductionRefreshOperationStatus> {
  const response = await fetcher(productionRefreshStatusUrl(websiteId, idempotencyKey), {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('PRODUCTION_REFRESH_STATUS_UNAVAILABLE');
  const payload = (await response.json()) as Partial<ProductionRefreshOperationStatus>;
  if (
    ![
      'processing',
      'pending',
      'running',
      'retryable',
      'succeeded',
      'failed',
      'not_found',
      'idle',
    ].includes(payload.status ?? '')
  )
    throw new Error('PRODUCTION_REFRESH_STATUS_INVALID');
  return payload as ProductionRefreshOperationStatus;
}
