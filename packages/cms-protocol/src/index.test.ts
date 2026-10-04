import { describe, expect, it } from 'vitest';
import { cmsCategorySchema, cmsOperationResultSchemas, cmsOperationSchema } from './index.js';

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

  it('accepts bounded hidden-by-default list subcategory creation', () => {
    expect(
      cmsOperationSchema.parse({
        operation: 'cms.category.create',
        payload: { parentCode: 'news_01', name: 'Industry News' },
      }),
    ).toEqual({
      operation: 'cms.category.create',
      payload: { parentCode: 'news_01', name: 'Industry News', status: '0' },
    });
    expect(
      cmsOperationSchema.safeParse({
        operation: 'cms.category.create',
        payload: { parentCode: 'news_01', name: 'Invalid', filename: '../admin' },
      }).success,
    ).toBe(false);
    expect(
      cmsOperationResultSchemas['cms.category.create'].safeParse({
        item: {
          scode: 'cc000001',
          name: 'Industry News',
          parentCode: 'news_01',
          modelCode: 'M01',
          modelType: 'list',
          status: '0',
          filename: '',
        },
        workspaceContentStale: true,
        replayed: false,
      }).success,
    ).toBe(true);
  });

  it('accepts only bounded raster image uploads and safe Production paths', () => {
    const payload = {
      attachmentId: '00000000-0000-4000-8000-000000000001',
      mimeType: 'image/png',
      contentSha256: version,
      contentBase64: 'aGVsbG8=',
    };
    expect(cmsOperationSchema.parse({ operation: 'cms.media.upload', payload }).operation).toBe(
      'cms.media.upload',
    );
    expect(
      cmsOperationSchema.safeParse({
        operation: 'cms.media.upload',
        payload: { ...payload, mimeType: 'image/svg+xml' },
      }).success,
    ).toBe(false);
    expect(
      cmsOperationResultSchemas['cms.media.upload'].safeParse({
        path: `/static/upload/image/cloudcrane/aa/${'a'.repeat(64)}.png`,
        mimeType: 'image/png',
        size: 5 * 1024 * 1024 + 1,
        contentSha256: version,
        workspaceContentStale: true,
        replayed: false,
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
