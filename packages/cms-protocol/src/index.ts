import { z } from 'zod';

const contentIdSchema = z.string().regex(/^\d{1,12}$/);
const pbootCodeSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,20}$/);
const versionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const fields = {
  title: z.string().max(100).optional(),
  subtitle: z.string().max(100).optional(),
  content: z.string().max(1_000_000).optional(),
  tags: z.string().max(500).optional(),
  keywords: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['0', '1']).optional(),
  author: z.string().max(30).optional(),
  source: z.string().max(30).optional(),
  date: z.string().max(19).optional(),
  outlink: z.string().max(100).optional(),
  filename: z.string().max(50).optional(),
};
const extensionFieldName = /^ext_[\w-]+$/;
const cmsImageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const maxCmsImageBytes = 5 * 1024 * 1024;
const maxCmsImageBase64Length = Math.ceil(maxCmsImageBytes / 3) * 4;

export const cmsActionSchemas = {
  'cms.categories.list': z.object({
    limit: z.number().int().min(1).max(100).default(50),
    cursor: pbootCodeSchema.optional(),
  }),
  'cms.content.list': z.object({
    categoryCode: pbootCodeSchema.optional(),
    query: z.string().max(200).optional(),
    status: z.enum(['0', '1']).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: contentIdSchema.optional(),
  }),
  'cms.content.get': z.object({ contentId: contentIdSchema }),
  'cms.category.create': z
    .object({
      parentCode: pbootCodeSchema,
      name: z.string().trim().min(1).max(100),
      filename: z
        .string()
        .max(30)
        .regex(/^(?:[a-zA-Z0-9-]+(?:\/[a-zA-Z0-9-]+)*)?$/)
        .optional(),
      status: z.enum(['0', '1']).default('0'),
    })
    .strict(),
  'cms.media.upload': z
    .object({
      attachmentId: z.string().uuid(),
      mimeType: cmsImageMimeSchema,
      contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
      contentBase64: z.string().min(1).max(maxCmsImageBase64Length),
    })
    .strict(),
  'cms.content.create': z
    .object({
      categoryCode: pbootCodeSchema,
      ...fields,
      title: z.string().min(1).max(100),
      extensionFields: z
        .record(
          z.string().regex(extensionFieldName),
          z.union([z.string().max(100_000), z.array(z.string().max(10_000)).max(100)]),
        )
        .optional(),
    })
    .strict(),
  'cms.content.update': z.object({
    contentId: contentIdSchema,
    expectedVersion: versionSchema,
    patch: z
      .object({
        ...fields,
        extensionFields: z
          .record(
            z.string().regex(extensionFieldName),
            z.union([z.string().max(100_000), z.array(z.string().max(10_000)).max(100)]),
          )
          .optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'patch must not be empty'),
  }),
  'cms.company.get': z.object({}),
  'cms.company.update': z.object({
    expectedVersion: versionSchema,
    patch: z
      .object({
        name: z.string().max(100).optional(),
        address: z.string().max(200).optional(),
        postcode: z.string().max(6).optional(),
        contact: z.string().max(10).optional(),
        mobile: z.string().max(50).optional(),
        phone: z.string().max(50).optional(),
        fax: z.string().max(50).optional(),
        email: z.string().max(30).optional(),
        qq: z.string().max(50).optional(),
        weixin: z.string().max(100).optional(),
        blicense: z.string().max(20).optional(),
        other: z.string().max(200).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'patch must not be empty'),
  }),
} as const;

export const cmsOperationSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('cms.categories.list'),
    payload: cmsActionSchemas['cms.categories.list'],
  }),
  z.object({
    operation: z.literal('cms.content.list'),
    payload: cmsActionSchemas['cms.content.list'],
  }),
  z.object({
    operation: z.literal('cms.content.get'),
    payload: cmsActionSchemas['cms.content.get'],
  }),
  z.object({
    operation: z.literal('cms.category.create'),
    payload: cmsActionSchemas['cms.category.create'],
  }),
  z.object({
    operation: z.literal('cms.media.upload'),
    payload: cmsActionSchemas['cms.media.upload'],
  }),
  z.object({
    operation: z.literal('cms.content.create'),
    payload: cmsActionSchemas['cms.content.create'],
  }),
  z.object({
    operation: z.literal('cms.content.update'),
    payload: cmsActionSchemas['cms.content.update'],
  }),
  z.object({
    operation: z.literal('cms.company.get'),
    payload: cmsActionSchemas['cms.company.get'],
  }),
  z.object({
    operation: z.literal('cms.company.update'),
    payload: cmsActionSchemas['cms.company.update'],
  }),
]);

export type CmsOperation = z.infer<typeof cmsOperationSchema>;
export type CmsOperationName = CmsOperation['operation'];
export type CmsPayload<K extends CmsOperationName> = Extract<
  CmsOperation,
  { operation: K }
>['payload'];

export const cmsCategorySchema = z.object({
  scode: pbootCodeSchema,
  name: z.string(),
  parentCode: pbootCodeSchema,
  modelCode: pbootCodeSchema,
  modelType: z.enum(['list', 'single']),
  status: z.enum(['0', '1']),
  filename: z.string(),
});

export const cmsCategoryCreateResultSchema = z.object({
  item: cmsCategorySchema,
  workspaceContentStale: z.literal(true),
  replayed: z.boolean(),
});

export const cmsContentSummarySchema = z.object({
  id: contentIdSchema,
  categoryCode: pbootCodeSchema,
  categoryName: z.string(),
  title: z.string(),
  status: z.enum(['0', '1']),
  date: z.string(),
  filename: z.string(),
});

export const cmsContentSchema = z.object({
  id: contentIdSchema,
  category: z.object({ code: pbootCodeSchema, name: z.string() }),
  title: z.string(),
  subtitle: z.string(),
  content: z.string(),
  tags: z.string(),
  keywords: z.string(),
  description: z.string(),
  status: z.enum(['0', '1']),
  author: z.string(),
  source: z.string(),
  date: z.string(),
  outlink: z.string(),
  filename: z.string(),
  extensionFields: z.record(z.string(), z.string()),
  version: versionSchema,
});

export const cmsCompanySchema = z.object({
  name: z.string(),
  address: z.string(),
  postcode: z.string(),
  contact: z.string(),
  mobile: z.string(),
  phone: z.string(),
  fax: z.string(),
  email: z.string(),
  qq: z.string(),
  weixin: z.string(),
  blicense: z.string(),
  other: z.string(),
  version: versionSchema,
});

export const cmsOperationResultSchemas = {
  'cms.categories.list': z.object({
    items: z.array(cmsCategorySchema),
    nextCursor: pbootCodeSchema.nullable(),
  }),
  'cms.content.list': z.object({
    items: z.array(cmsContentSummarySchema),
    nextCursor: contentIdSchema.nullable(),
  }),
  'cms.content.get': cmsContentSchema,
  'cms.category.create': cmsCategoryCreateResultSchema,
  'cms.media.upload': z.object({
    path: z
      .string()
      .regex(/^\/static\/upload\/image\/cloudcrane\/[a-f0-9]{2}\/[a-f0-9]{64}\.(?:jpg|png|webp)$/),
    mimeType: cmsImageMimeSchema,
    size: z.number().int().positive().max(maxCmsImageBytes),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    workspaceContentStale: z.literal(true),
    replayed: z.boolean(),
  }),
  'cms.content.update': z.object({
    item: cmsContentSchema,
    workspaceContentStale: z.literal(true),
    replayed: z.boolean(),
  }),
  'cms.content.create': z.object({
    item: cmsContentSchema,
    workspaceContentStale: z.literal(true),
    replayed: z.boolean(),
  }),
  'cms.company.get': cmsCompanySchema,
  'cms.company.update': z.object({
    item: cmsCompanySchema,
    workspaceContentStale: z.literal(true),
    replayed: z.boolean(),
  }),
} as const;

export type CmsOperationResult<K extends CmsOperationName> = z.infer<
  (typeof cmsOperationResultSchemas)[K]
>;
