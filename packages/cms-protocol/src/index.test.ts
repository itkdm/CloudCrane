import { describe, expect, it } from 'vitest';
import { cmsCategorySchema, cmsOperationSchema } from './index.js';

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

  it('accepts bounded alphanumeric Pboot codes while keeping row IDs numeric', () => {
    expect(
      cmsOperationSchema.parse({
        operation: 'cms.content.list',
        payload: { categoryCode: 'news_01', cursor: '123' },
      }).operation,
    ).toBe('cms.content.list');
    expect(
      cmsOperationSchema.safeParse({
        operation: 'cms.content.get',
        payload: { contentId: 'news01' },
      }).success,
    ).toBe(false);
    expect(
      cmsOperationSchema.safeParse({
        operation: 'cms.content.list',
        payload: { categoryCode: 'invalid.code' },
      }).success,
    ).toBe(false);
  });

  it('validates Pboot logical-code values in operation results', () => {
    expect(
      cmsCategorySchema.safeParse({
        scode: 'news01',
        name: 'News',
        parentCode: 'parent-01',
        modelCode: 'M01',
        modelType: 'list',
        status: '1',
        filename: 'news',
      }).success,
    ).toBe(true);
    expect(
      cmsCategorySchema.safeParse({
        scode: 'a'.repeat(21),
        name: 'News',
        parentCode: '0',
        modelCode: 'M01',
        modelType: 'list',
        status: '1',
        filename: 'news',
      }).success,
    ).toBe(false);
  });

  it('accepts content creation only with a category and non-empty title', () => {
    expect(
      cmsOperationSchema.parse({
        operation: 'cms.content.create',
        payload: { categoryCode: 'news_01', title: 'A new article' },
      }).operation,
    ).toBe('cms.content.create');
    expect(
      cmsOperationSchema.safeParse({
        operation: 'cms.content.create',
        payload: { categoryCode: 'news_01', title: '' },
      }).success,
    ).toBe(false);
    expect(
      cmsOperationSchema.safeParse({
        operation: 'cms.content.create',
        payload: { categoryCode: 'news_01', title: 'A new article', status: 'published' },
      }).success,
    ).toBe(false);
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
