import { describe, expect, it } from 'vitest';
import { generatePreviewSlug, isPreviewSlug, PREVIEW_SLUG_LENGTH } from './preview-slug.js';

describe('preview slugs', () => {
  it('generates lowercase 12-character URL-safe slugs', () => {
    const slug = generatePreviewSlug();
    expect(slug).toHaveLength(PREVIEW_SLUG_LENGTH);
    expect(isPreviewSlug(slug)).toBe(true);
    expect(slug).toMatch(/^[a-z0-9]{12}$/);
  });

  it('rejects UUIDs, uppercase values, and malformed lengths', () => {
    expect(isPreviewSlug('ABC123def456')).toBe(false);
    expect(isPreviewSlug('12345678901')).toBe(false);
    expect(isPreviewSlug('00000000-0000-4000-8000-000000000001')).toBe(false);
  });
});
