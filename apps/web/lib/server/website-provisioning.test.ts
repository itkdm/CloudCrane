import { describe, expect, it, vi } from 'vitest';
import { WorkspaceClientError } from '@cloudcrane/workspace-client';
import {
  WEBSITE_PROVISIONING_FAILED,
  WEBSITE_READY,
  createWebsite,
  listWebsites,
  validateWebsiteName,
} from './website-provisioning.js';

const created = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '测试网站',
  status: 'provisioning',
  createdAt: new Date('2026-09-01T00:00:00Z'),
};

function store(overrides: Partial<Parameters<typeof createWebsite>[1]['store']> = {}) {
  return {
    persistDesiredState: vi.fn(async () => created),
    updateWebsiteStatus: vi.fn(async () => undefined),
    listWebsites: vi.fn(async () => [created]),
    ...overrides,
  };
}

describe('website provisioning foundation', () => {
  it('validates and trims a website name', () => {
    expect(validateWebsiteName('  我的站点  ')).toBe('我的站点');
    expect(() => validateWebsiteName('')).toThrow('1 至 80');
    expect(() => validateWebsiteName('x'.repeat(81))).toThrow('1 至 80');
  });

  it('does not invoke runtime when desired-state persistence fails', async () => {
    const persist = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const runtime = vi.fn(() => ({
      create: vi.fn(),
      status: vi.fn(),
      bootstrap: vi.fn(),
      reconcileBootstrap: vi.fn(),
    }));
    await expect(
      createWebsite('站点', { store: store({ persistDesiredState: persist }), runtime }),
    ).rejects.toThrow('database unavailable');
    expect(runtime).not.toHaveBeenCalled();
  });

  it('marks the website ready after runtime creation', async () => {
    const update = vi.fn(async () => undefined);
    const result = await createWebsite('站点', {
      store: store({ updateWebsiteStatus: update }),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap: vi.fn(async () => ({ status: 'INITIALIZED' })),
        reconcileBootstrap: vi.fn(),
      }),
    });
    expect(result.website.status).toBe(WEBSITE_READY);
    expect(update).toHaveBeenCalledWith(expect.any(String), WEBSITE_READY);
  });

  it('retains records and marks a definite runtime failure', async () => {
    const update = vi.fn(async () => undefined);
    const result = await createWebsite('站点', {
      store: store({ updateWebsiteStatus: update }),
      runtime: () => ({
        create: vi.fn(async () => {
          throw new WorkspaceClientError('RUNNER_UNAVAILABLE', 'runner unavailable');
        }),
        status: vi.fn(),
        bootstrap: vi.fn(),
        reconcileBootstrap: vi.fn(),
      }),
    });
    expect(result.website.status).toBe(WEBSITE_PROVISIONING_FAILED);
    expect(update).toHaveBeenCalledWith(expect.any(String), WEBSITE_PROVISIONING_FAILED);
  });

  it('reconciles an unknown create result through runtime status', async () => {
    const update = vi.fn(async () => undefined);
    const status = vi.fn(async () => ({ status: 'running' }));
    const result = await createWebsite('站点', {
      store: store({ updateWebsiteStatus: update }),
      runtime: () => ({
        create: vi.fn(async () => {
          throw new WorkspaceClientError('UNKNOWN_RESULT', 'outcome unknown');
        }),
        status,
        bootstrap: vi.fn(async () => ({ status: 'INITIALIZED' })),
        reconcileBootstrap: vi.fn(),
      }),
    });
    expect(status).toHaveBeenCalledOnce();
    expect(result.website.status).toBe(WEBSITE_READY);
  });

  it('marks bootstrap failure as initialization_failed without retrying', async () => {
    const update = vi.fn(async () => undefined);
    const bootstrap = vi.fn(async () => ({ status: 'FAILED' }));
    const result = await createWebsite('站点', {
      store: store({ updateWebsiteStatus: update }),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap,
        reconcileBootstrap: vi.fn(),
      }),
    });
    expect(result.website.status).toBe('initialization_failed');
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it('reconciles an unknown bootstrap result without retrying bootstrap', async () => {
    const bootstrap = vi.fn(async () => {
      throw new WorkspaceClientError('UNKNOWN_RESULT', 'bootstrap outcome unknown');
    });
    const reconcileBootstrap = vi.fn(async () => true);
    const result = await createWebsite('站点', {
      store: store(),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap,
        reconcileBootstrap,
      }),
    });
    expect(result.website.status).toBe(WEBSITE_READY);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(reconcileBootstrap).toHaveBeenCalledOnce();
  });

  it('does not expose runtime or credential fields in the public view', async () => {
    const result = await createWebsite('站点', {
      store: store(),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap: vi.fn(async () => ({ status: 'INITIALIZED' })),
        reconcileBootstrap: vi.fn(),
      }),
    });
    expect(result.website).toEqual(expect.objectContaining({ id: created.id, name: '测试网站' }));
    expect(result.website).not.toHaveProperty('workspaceId');
    expect(result.website).not.toHaveProperty('token');
    expect(result.website).not.toHaveProperty('endpoint');
  });

  it('lists only the public website fields', async () => {
    const result = await listWebsites({ listWebsites: async () => [created] });
    expect(result).toEqual([created]);
  });
});
