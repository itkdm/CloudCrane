import { describe, expect, it } from 'vitest';
import { safeCallbackUrl } from './safe-callback-url.js';

describe('safeCallbackUrl', () => {
  it('keeps same-origin paths and query strings', () => {
    expect(safeCallbackUrl('/zh/app/websites?view=templates#top', 'zh')).toBe(
      '/zh/app/websites?view=templates#top',
    );
  });

  it('uses the default destination for external and browser-normalized network paths', () => {
    for (const value of [
      'https://evil.example/path',
      '//evil.example/path',
      '/\\evil.example/path',
      '/\\\\evil.example/path',
    ]) {
      expect(safeCallbackUrl(value, 'zh')).toBe('/zh/app/websites');
    }
  });

  it('uses the default destination when no callback URL is provided', () => {
    expect(safeCallbackUrl(null, 'en')).toBe('/en/app/websites');
  });
});
