import { describe, expect, it } from 'vitest';
import { isWebsiteRelativePath, previewObservationSchema } from './index.js';

describe('preview protocol', () => {
  it('accepts website-relative paths and rejects authority-bearing URLs', () => {
    expect(isWebsiteRelativePath('/about?tab=team')).toBe(true);
    expect(isWebsiteRelativePath('//evil.example/')).toBe(false);
    expect(isWebsiteRelativePath('https://evil.example/')).toBe(false);
    expect(isWebsiteRelativePath('javascript:alert(1)')).toBe(false);
  });

  it('keeps observation data bounded and typed', () => {
    const result = previewObservationSchema.safeParse({
      url: 'https://preview.example/',
      path: '/',
      title: 'Preview',
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      scroll: { x: 0, y: 0 },
      dom: [],
      domTruncated: false,
      visibleText: '',
      consoleErrors: [],
      windowErrors: [],
      capturedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(
      previewObservationSchema.safeParse({
        url: 'https://preview.example/',
        path: '/',
        title: 'Preview',
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
        scroll: { x: 0, y: 0 },
        dom: [],
        domTruncated: false,
        visibleText: 'x'.repeat(32_001),
        consoleErrors: [],
        windowErrors: [],
        capturedAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
});
