import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARE_EXPIRATION,
  hashShareToken,
  isShareExpiration,
  SHARE_EXPIRATIONS,
  shareUrlForWebsite,
} from './website-shares.js';

describe('website shares', () => {
  it('allows only the supported expiration windows and defaults to one day', () => {
    expect(DEFAULT_SHARE_EXPIRATION).toBe('1d');
    expect(Object.keys(SHARE_EXPIRATIONS)).toEqual(['1h', '1d', '7d', '30d']);
    expect(isShareExpiration('1h')).toBe(true);
    expect(isShareExpiration('2d')).toBe(false);
  });

  it('hashes the opaque token and never puts the hash in the share URL', () => {
    const token = 'opaque-token-for-test';
    expect(hashShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
    const url = shareUrlForWebsite('https://abc.preview.example.test/', token);
    expect(url).toBe('https://abc.preview.example.test/?share=opaque-token-for-test');
    expect(url).not.toContain(hashShareToken(token));
  });
});
