import { describe, expect, it, vi } from 'vitest';
import {
  getProductionRefreshOperation,
  isProductionRefreshInFlight,
  productionRefreshStatusUrl,
} from './production-refresh-operation.js';

describe('Production refresh operation recovery', () => {
  it('looks up the operation for the persisted key instead of the latest operation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ operationId: 'operation-a', status: 'succeeded' }));

    await expect(getProductionRefreshOperation('website-1', 'key-a', fetcher)).resolves.toEqual({
      operationId: 'operation-a',
      status: 'succeeded',
    });
    expect(fetcher).toHaveBeenCalledWith(productionRefreshStatusUrl('website-1', 'key-a'), {
      cache: 'no-store',
    });
  });

  it.each(['processing', 'pending', 'running', 'retryable'])(
    'resumes polling for %s operations',
    (status) => {
      expect(isProductionRefreshInFlight(status)).toBe(true);
    },
  );

  it.each(['succeeded', 'failed', 'not_found', 'idle'])(
    'does not resume %s operations',
    (status) => {
      expect(isProductionRefreshInFlight(status)).toBe(false);
    },
  );

  it('fails closed when the status response is unavailable or invalid', async () => {
    await expect(
      getProductionRefreshOperation(
        'website-1',
        'key-a',
        async () => new Response(null, { status: 503 }),
      ),
    ).rejects.toThrow('PRODUCTION_REFRESH_STATUS_UNAVAILABLE');
    await expect(
      getProductionRefreshOperation('website-1', 'key-a', async () =>
        Response.json({ status: 'unknown' }),
      ),
    ).rejects.toThrow('PRODUCTION_REFRESH_STATUS_INVALID');
  });
});
