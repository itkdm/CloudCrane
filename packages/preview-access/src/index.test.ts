import { describe, expect, it } from 'vitest';
import { signPreviewToken, verifyPreviewToken } from './index.js';

const claims = { websiteId: '00000000-0000-4000-8000-000000000001', expiresAt: 2_000_000_000 };

describe('preview access token', () => {
  it('signs and verifies short-lived claims', () => {
    const token = signPreviewToken(claims, 'test-secret');
    expect(verifyPreviewToken(token, 'test-secret', 1_000)).toEqual(claims);
    expect(verifyPreviewToken(token, 'wrong-secret', 1_000)).toBeNull();
  });

  it('rejects expired claims', () => {
    const token = signPreviewToken({ ...claims, expiresAt: 1 }, 'test-secret');
    expect(verifyPreviewToken(token, 'test-secret', 2_000)).toBeNull();
  });
});
