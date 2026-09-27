import { describe, expect, it } from 'vitest';
import { captureAuthRequest } from './auth-request.js';

describe('captureAuthRequest', () => {
  it('returns the successful request result', async () => {
    await expect(captureAuthRequest(async () => 'ok')).resolves.toEqual({
      ok: true,
      value: 'ok',
    });
  });

  it('captures rejected requests so auth forms can show their error state', async () => {
    await expect(
      captureAuthRequest(async () => {
        throw new Error('network failed');
      }),
    ).resolves.toEqual({ ok: false });
  });
});
