import { describe, expect, it } from 'vitest';
import { calculatePreviewRenewAt, isPreviewAccessFresh } from './preview-access';

describe('preview access freshness', () => {
  it('uses a dynamic lead between five and sixty seconds', () => {
    const now = 1_000_000;
    expect(calculatePreviewRenewAt((now + 600_000) / 1000, now)).toBe(now + 540_000);
    expect(calculatePreviewRenewAt((now + 20_000) / 1000, now)).toBe(now + 15_000);
  });

  it('marks access stale at its calculated renewal point', () => {
    const now = 1_000_000;
    const access = { url: 'https://preview.example/', expiresAt: (now + 600_000) / 1000 };
    expect(isPreviewAccessFresh(access, now + 539_999, now)).toBe(true);
    expect(isPreviewAccessFresh(access, now + 540_000, now)).toBe(false);
  });
});
