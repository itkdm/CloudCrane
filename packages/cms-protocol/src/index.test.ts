import { describe, expect, it } from 'vitest';
import { cmsOperationSchema } from './index.js';

const version = 'a'.repeat(64);

describe('CMS semantic protocol', () => {
  it('accepts the read and allowlisted update operations', () => {
    expect(
      cmsOperationSchema.parse({ operation: 'cms.categories.list', payload: { limit: 10 } })
        .operation,
    ).toBe('cms.categories.list');
    expect(
      cmsOperationSchema.parse({
        operation: 'cms.content.update',
        payload: {
          contentId: '12',
          expectedVersion: version,
          patch: { title: 'Revised', extensionFields: { ext_color: 'blue' } },
        },
      }).operation,
    ).toBe('cms.content.update');
  });

  it.each([
    {
      operation: 'cms.content.update',
      payload: { contentId: '12', expectedVersion: version, patch: { acode: 'cn' } },
    },
    { operation: 'cms.company.update', payload: { expectedVersion: version, patch: { id: 1 } } },
    { operation: 'cms.content.delete', payload: { contentId: '12' } },
  ])('rejects an unsupported CMS field or operation', (value) => {
    expect(cmsOperationSchema.safeParse(value).success).toBe(false);
  });
});
