import { Type, type Static } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { CmsClient } from '@cloudcrane/workspace-client';
import { ProductionClientError } from '@cloudcrane/workspace-client';

const categoryCode = Type.String({ pattern: '^[a-zA-Z0-9_-]{1,20}$' });
const contentId = Type.String({ pattern: '^\\d{1,12}$' });
const version = Type.String({ pattern: '^[a-f0-9]{64}$' });
const listCategoriesParameters = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(categoryCode),
});
const listContentParameters = Type.Object({
  categoryCode: Type.Optional(categoryCode),
  query: Type.Optional(Type.String({ maxLength: 200 })),
  status: Type.Optional(Type.Union([Type.Literal('0'), Type.Literal('1')])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(contentId),
});
const createCategoryParameters = Type.Object({
  parentCode: categoryCode,
  name: Type.String({ minLength: 1, maxLength: 100 }),
  filename: Type.Optional(
    Type.String({ maxLength: 30, pattern: '^(?:[a-zA-Z0-9-]+(?:/[a-zA-Z0-9-]+)*)?$' }),
  ),
  status: Type.Optional(Type.Union([Type.Literal('0'), Type.Literal('1')])),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
});
const contentPatch = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 100 })),
  subtitle: Type.Optional(Type.String({ maxLength: 100 })),
  content: Type.Optional(Type.String({ maxLength: 1_000_000 })),
  tags: Type.Optional(Type.String({ maxLength: 500 })),
  keywords: Type.Optional(Type.String({ maxLength: 200 })),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  status: Type.Optional(Type.Union([Type.Literal('0'), Type.Literal('1')])),
  author: Type.Optional(Type.String({ maxLength: 30 })),
  source: Type.Optional(Type.String({ maxLength: 30 })),
  date: Type.Optional(Type.String({ maxLength: 19 })),
  outlink: Type.Optional(Type.String({ maxLength: 100 })),
  filename: Type.Optional(Type.String({ maxLength: 50 })),
  extensionFields: Type.Optional(
    Type.Record(
      Type.String({ pattern: '^ext_[\\w-]+$' }),
      Type.Union([
        Type.String({ maxLength: 100_000 }),
        Type.Array(Type.String({ maxLength: 10_000 }), { maxItems: 100 }),
      ]),
    ),
  ),
});

const companyPatch = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  address: Type.Optional(Type.String({ maxLength: 200 })),
  postcode: Type.Optional(Type.String({ maxLength: 6 })),
  contact: Type.Optional(Type.String({ maxLength: 10 })),
  mobile: Type.Optional(Type.String({ maxLength: 50 })),
  phone: Type.Optional(Type.String({ maxLength: 50 })),
  fax: Type.Optional(Type.String({ maxLength: 50 })),
  email: Type.Optional(Type.String({ maxLength: 30 })),
  qq: Type.Optional(Type.String({ maxLength: 50 })),
  weixin: Type.Optional(Type.String({ maxLength: 100 })),
  blicense: Type.Optional(Type.String({ maxLength: 20 })),
  other: Type.Optional(Type.String({ maxLength: 200 })),
});
const createContentParameters = Type.Object({
  categoryCode,
  ...contentPatch.properties,
  title: Type.String({ minLength: 1, maxLength: 100 }),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
});
const uploadMediaParameters = Type.Object({
  attachmentIndex: Type.Integer({ minimum: 1, maximum: 8 }),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
});

export type CmsMediaAttachment = {
  attachmentId: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  contentSha256: string;
  contentBase64: string;
};

export function createCmsTools(
  client: CmsClient,
  options: {
    resolveMediaAttachment?: (attachmentIndex: number) => Promise<CmsMediaAttachment>;
  } = {},
) {
  return {
    cms_list_categories: tool(
      'cms_list_categories',
      'List categories from the live Production CMS. This reads published website content, not Workspace files.',
      listCategoriesParameters,
      (input) => client.listCategories(input),
    ),
    cms_list_content: tool(
      'cms_list_content',
      'List a limited set of content summaries from the live Production CMS. Use cms_get_content for the full body.',
      listContentParameters,
      (input) => client.listContent(input),
    ),
    cms_get_content: tool(
      'cms_get_content',
      'Read one content item and its current version from the live Production CMS before editing it.',
      Type.Object({ contentId }),
      (input) => client.getContent(input),
    ),
    cms_category_create: tool(
      'cms_category_create',
      'Create one hidden-by-default list subcategory under an existing active list category in the live Production CMS. Read categories first and use a parentCode from that list; the new category inherits its model and templates. Set status to 1 only when explicitly requested. This does not create or change a CMS model. On UNKNOWN_RESULT, retry the identical payload with the returned idempotencyKey.',
      createCategoryParameters,
      async ({ idempotencyKey: suppliedKey, ...payload }, toolCallId) => {
        const idempotencyKey = suppliedKey ?? operationKey('category', toolCallId);
        try {
          return await client.createCategory(payload, { idempotencyKey });
        } catch (error) {
          if (error instanceof ProductionClientError && error.code === 'UNKNOWN_RESULT') {
            return {
              status: 'unknown',
              code: error.code,
              idempotencyKey,
              retry: 'Repeat the identical cms_category_create payload and this idempotencyKey.',
            };
          }
          throw error;
        }
      },
    ),
    cms_content_create: tool(
      'cms_content_create',
      'Create one item in an existing active list category in the live Production CMS. Read categories first. New items default to hidden status 0; set status to 1 only when explicitly requested. This does not create categories or upload media. If the result is UNKNOWN_RESULT, retry the exact same fields with the returned idempotencyKey; never make a new key for that attempt. Production content writes can leave Preview stale until Production → Workspace Refresh.',
      createContentParameters,
      async (input, toolCallId) => {
        const { idempotencyKey: suppliedKey, ...payload } = input;
        const idempotencyKey = suppliedKey ?? operationKey('create', toolCallId);
        try {
          return await client.createContent(payload, { idempotencyKey });
        } catch (error) {
          if (error instanceof ProductionClientError && error.code === 'UNKNOWN_RESULT') {
            return {
              status: 'unknown',
              code: error.code,
              idempotencyKey,
              retry: 'Repeat the identical cms_content_create payload and this idempotencyKey.',
            };
          }
          throw error;
        }
      },
    ),
    ...(options.resolveMediaAttachment
      ? {
          cms_media_upload: tool(
            'cms_media_upload',
            'Upload one image explicitly attached to the current user message into the live Production CMS. Use the 1-based attachmentIndex shown in the current user message; only upload an image the user asked to publish or use. Supports PNG, JPEG, and WebP up to 5 MiB with dimensions up to 10000 pixels per side and 16 megapixels total; images larger than 8 megapixels are proportionally downscaled before storage. The returned /static/upload path can be placed in CMS content. On UNKNOWN_RESULT, retry with the same attachmentIndex and returned idempotencyKey; never make a new key for that attempt.',
            uploadMediaParameters,
            async ({ attachmentIndex, idempotencyKey: suppliedKey }, toolCallId) => {
              const media = await options.resolveMediaAttachment!(attachmentIndex);
              const idempotencyKey = suppliedKey ?? operationKey('media', toolCallId);
              try {
                return await client.uploadMedia(media, { idempotencyKey });
              } catch (error) {
                if (error instanceof ProductionClientError && error.code === 'UNKNOWN_RESULT') {
                  return {
                    status: 'unknown',
                    code: error.code,
                    attachmentIndex,
                    idempotencyKey,
                    retry:
                      'Repeat cms_media_upload with the same attachmentIndex and this idempotencyKey.',
                  };
                }
                throw error;
              }
            },
          ),
        }
      : {}),
    cms_update_content: tool(
      'cms_update_content',
      'Update allowlisted fields on an existing item in the live Production CMS. First call cms_get_content and use its version. On CMS_CONTENT_CHANGED, fetch again and reconsider. On UNKNOWN_RESULT, retry the same patch with the same expectedVersion; the CMS safely replays it if the earlier write committed. Never edit Workspace SQLite to change live content. Production updates can leave Preview content stale until Production → Workspace Refresh.',
      Type.Object({ contentId, expectedVersion: version, patch: contentPatch }),
      (input, toolCallId) =>
        client.updateContent(input, { idempotencyKey: operationKey('content', toolCallId) }),
    ),
    cms_get_company: tool(
      'cms_get_company',
      'Read the current company fields and version from the live Production CMS.',
      Type.Object({}),
      () => client.getCompany(),
    ),
    cms_update_company: tool(
      'cms_update_company',
      'Update allowlisted company fields in the live Production CMS. First call cms_get_company and use its version. On CMS_CONTENT_CHANGED, read again before deciding. On UNKNOWN_RESULT, retry the same patch with the same expectedVersion; the CMS safely replays it if the earlier write committed. Code and templates still belong in Workspace.',
      Type.Object({ expectedVersion: version, patch: companyPatch }),
      (input, toolCallId) =>
        client.updateCompany(input, { idempotencyKey: operationKey('company', toolCallId) }),
    ),
  };
}

function operationKey(kind: string, toolCallId: string) {
  const callHash = createHash('sha256').update(toolCallId).digest('hex');
  return `cms-${kind}-${callHash}`;
}

function tool<TSchema extends ReturnType<typeof Type.Object>>(
  name: string,
  description: string,
  parameters: TSchema,
  execute: (input: Static<TSchema>, toolCallId: string) => Promise<unknown>,
): ToolDefinition<TSchema> {
  return {
    name,
    label: name,
    description,
    promptSnippet: description,
    parameters,
    execute: async (toolCallId, input) => {
      const result = await execute(input, toolCallId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  };
}
import { createHash } from 'node:crypto';
