import { describe, expect, it } from 'vitest';
import { resolvePreviewSource } from './preview-source';

describe('resolvePreviewSource', () => {
  it('uses the current URL on the preview origin', () => {
    expect(
      resolvePreviewSource('https://site.example/', 'https://site.example/about?x=1#team'),
    ).toBe('https://site.example/about?x=1#team');
  });

  it('falls back to the base URL for an invalid or cross-origin current URL', () => {
    expect(resolvePreviewSource('https://site.example/', 'https://evil.example/')).toBe(
      'https://site.example/',
    );
    expect(resolvePreviewSource('https://site.example/', 'not a URL')).toBe(
      'https://site.example/',
    );
  });
});
