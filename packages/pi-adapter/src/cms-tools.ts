import { Type, type Static } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { CmsClient } from '@cloudcrane/workspace-client';

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

export function createCmsTools(client: CmsClient) {
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
