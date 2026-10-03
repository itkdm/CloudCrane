import { describe, expect, it, vi } from 'vitest';
import { createCmsTools } from './cms-tools.js';

describe('CMS Agent tools', () => {
  it('exposes semantic reads and versioned updates only', async () => {
    const client = {
      listCategories: vi.fn().mockResolvedValue({ items: [] }),
      listContent: vi.fn().mockResolvedValue({ items: [] }),
      getContent: vi.fn().mockResolvedValue({ id: '4', version: 'a'.repeat(64) }),
      updateContent: vi.fn().mockResolvedValue({ workspaceContentStale: true }),
      getCompany: vi.fn().mockResolvedValue({ version: 'b'.repeat(64) }),
      updateCompany: vi.fn().mockResolvedValue({ workspaceContentStale: true }),
    };
    const tools = createCmsTools(client as never);
    expect(Object.keys(tools)).toEqual([
      'cms_list_categories',
      'cms_list_content',
      'cms_get_content',
      'cms_update_content',
      'cms_get_company',
      'cms_update_company',
    ]);

    await tools.cms_update_company.execute(
      'call-1',
      {
        expectedVersion: 'b'.repeat(64),
        patch: { phone: '13800000000' },
      } as never,
      undefined,
      undefined,
      undefined as never,
    );
    expect(client.updateCompany).toHaveBeenCalledWith(
      { expectedVersion: 'b'.repeat(64), patch: { phone: '13800000000' } },
      { idempotencyKey: expect.stringMatching(/^cms-company-/) },
    );
  });

  it('accepts Pboot logical category codes in list tools', () => {
    const tools = createCmsTools({} as never);
    const cursor = tools.cms_list_categories.parameters.properties.cursor as unknown as {
      pattern?: string;
    };
    const categoryCode = tools.cms_list_content.parameters.properties.categoryCode as unknown as {
      pattern?: string;
    };
    expect(cursor.pattern).toBe('^[a-zA-Z0-9_-]{1,20}$');
    expect(categoryCode.pattern).toBe('^[a-zA-Z0-9_-]{1,20}$');
  });
});
