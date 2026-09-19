import { describe, expect, it, vi } from 'vitest';
import { WorkspaceClientError } from '@cloudcrane/workspace-client';
import {
  WEBSITE_PROVISIONING_FAILED,
  WEBSITE_AUTHORIZATION_REQUIRED,
  WEBSITE_TEMPLATE_ATTACH_FAILED,
  TEMPLATE_ATTACHMENT_STALE_AFTER_MS,
  createWebsite,
  listWebsites,
  retryTemplateAttachment,
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
      configureAuthorization: vi.fn(),
      verifyAuthorization: vi.fn(),
    }));
    await expect(
      createWebsite('站点', {
        ownerId: 'user-1',
        store: store({ persistDesiredState: persist }),
        runtime,
      }),
    ).rejects.toThrow('database unavailable');
    expect(runtime).not.toHaveBeenCalled();
  });

  it('marks the website authorization_required after bootstrap', async () => {
    const update = vi.fn(async () => undefined);
    const result = await createWebsite('站点', {
      ownerId: 'user-1',
      store: store({ updateWebsiteStatus: update }),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap: vi.fn(async () => ({ status: 'INITIALIZED' })),
        reconcileBootstrap: vi.fn(),
        configureAuthorization: vi.fn(),
        verifyAuthorization: vi.fn(),
      }),
    });
    expect(result.website.status).toBe(WEBSITE_AUTHORIZATION_REQUIRED);
    expect(update).toHaveBeenCalledWith(expect.any(String), WEBSITE_AUTHORIZATION_REQUIRED);
  });

  it('materializes a selected template before authorization', async () => {
    const attach = vi.fn(async () => ({ referenceId: 'ref_template' }));
    const attachment = vi.fn(async () => 4);
    const finalize = vi.fn(async () => true);
    const result = await createWebsite('站点', {
      ownerId: 'user-1',
      template: {
        id: '00000000-0000-4000-8000-000000000009',
        artifactStorageKey: 'template-a.zip',
        artifactSha256: 'a'.repeat(64),
      },
      store: store({ updateTemplateAttachment: attachment, finalizeTemplateAttachment: finalize }),
      attachTemplate: attach,
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap: vi.fn(async () => ({ status: 'INITIALIZED' })),
        reconcileBootstrap: vi.fn(),
        configureAuthorization: vi.fn(),
        verifyAuthorization: vi.fn(),
      }),
    });
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({
        template: expect.objectContaining({ artifactStorageKey: 'template-a.zip' }),
      }),
    );
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        websiteStatus: WEBSITE_AUTHORIZATION_REQUIRED,
        expectedAttemptCount: 4,
        referenceId: 'ref_template',
      }),
    );
    expect(result.website.status).toBe(WEBSITE_AUTHORIZATION_REQUIRED);
  });

  it('retains the website when template materialization fails', async () => {
    const updateStatus = vi.fn(async () => undefined);
    const attachment = vi.fn(async () => undefined);
    const result = await createWebsite('站点', {
      ownerId: 'user-1',
      template: {
        id: '00000000-0000-4000-8000-000000000009',
        artifactStorageKey: 'template-a.zip',
        artifactSha256: 'a'.repeat(64),
      },
      store: store({ updateWebsiteStatus: updateStatus, updateTemplateAttachment: attachment }),
      attachTemplate: vi.fn(async () => {
        throw new Error('hash mismatch');
      }),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap: vi.fn(async () => ({ status: 'INITIALIZED' })),
        reconcileBootstrap: vi.fn(),
        configureAuthorization: vi.fn(),
        verifyAuthorization: vi.fn(),
      }),
    });
    expect(result.website.status).toBe(WEBSITE_TEMPLATE_ATTACH_FAILED);
    expect(updateStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      WEBSITE_TEMPLATE_ATTACH_FAILED,
    );
    expect(attachment).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('reclaims a stale materializing attachment with a timestamp CAS', async () => {
    const update = vi.fn(async () => 4);
    const attach = vi.fn(async () => ({ referenceId: 'ref_template' }));
    const staleUpdatedAt = new Date(Date.now() - TEMPLATE_ATTACHMENT_STALE_AFTER_MS - 1_000);

    await retryTemplateAttachment('website-1', {
      workspaceId: 'workspace-1',
      store: {
        findTemplateAttachment: async () => ({
          templateId: 'template-1',
          artifactStorageKey: 'template-1.zip',
          artifactSha256: 'a'.repeat(64),
          status: 'materializing',
          referenceId: null,
          attemptCount: 3,
          updatedAt: staleUpdatedAt,
        }),
        updateTemplateAttachment: update,
        updateWebsiteStatus: vi.fn(async () => undefined),
      },
      attachTemplate: attach,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'materializing',
        expectedStatus: 'materializing',
        staleBefore: expect.any(Date),
      }),
    );
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ready', expectedAttemptCount: 4 }),
    );
    expect(attach).toHaveBeenCalledOnce();
  });

  it('rejects a fresh materializing attachment without touching the Agent', async () => {
    const attach = vi.fn();

    await expect(
      retryTemplateAttachment('website-1', {
        workspaceId: 'workspace-1',
        store: {
          findTemplateAttachment: async () => ({
            templateId: 'template-1',
            artifactStorageKey: 'template-1.zip',
            artifactSha256: 'a'.repeat(64),
            status: 'materializing',
            referenceId: null,
            attemptCount: 3,
            updatedAt: new Date(),
          }),
          updateTemplateAttachment: vi.fn(),
          updateWebsiteStatus: vi.fn(),
        },
        attachTemplate: attach,
      }),
    ).rejects.toThrow('模板正在应用');
    expect(attach).not.toHaveBeenCalled();
  });

  it('does not attach when a stale claim loses its CAS race', async () => {
    const attach = vi.fn();

    await expect(
      retryTemplateAttachment('website-1', {
        workspaceId: 'workspace-1',
        store: {
          findTemplateAttachment: async () => ({
            templateId: 'template-1',
            artifactStorageKey: 'template-1.zip',
            artifactSha256: 'a'.repeat(64),
            status: 'materializing',
            referenceId: null,
            attemptCount: 3,
            updatedAt: new Date(Date.now() - TEMPLATE_ATTACHMENT_STALE_AFTER_MS - 1_000),
          }),
          updateTemplateAttachment: vi.fn(async () => false),
          updateWebsiteStatus: vi.fn(),
        },
        attachTemplate: attach,
      }),
    ).rejects.toThrow('模板正在应用');
    expect(attach).not.toHaveBeenCalled();
  });

  it('does not let a reclaimed worker update website state after its fencing token is lost', async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const updateWebsiteStatus = vi.fn();

    await expect(
      retryTemplateAttachment('website-1', {
        workspaceId: 'workspace-1',
        store: {
          findTemplateAttachment: async () => ({
            templateId: 'template-1',
            artifactStorageKey: 'template-1.zip',
            artifactSha256: 'a'.repeat(64),
            status: 'materializing',
            referenceId: null,
            attemptCount: 3,
            updatedAt: new Date(Date.now() - TEMPLATE_ATTACHMENT_STALE_AFTER_MS - 1_000),
          }),
          updateTemplateAttachment: update,
          updateWebsiteStatus,
        },
        attachTemplate: async () => ({ referenceId: 'ref-template' }),
      }),
    ).rejects.toThrow('模板应用已被其他任务接管');

    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'materializing', incrementAttempt: true }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'ready', expectedAttemptCount: 4 }),
    );
    expect(updateWebsiteStatus).not.toHaveBeenCalled();
  });

  it('repairs website status when the attachment is already ready', async () => {
    const updateWebsiteStatus = vi.fn(async () => undefined);

    await expect(
      retryTemplateAttachment('website-1', {
        workspaceId: 'workspace-1',
        store: {
          findTemplateAttachment: async () => ({
            templateId: 'template-1',
            artifactStorageKey: 'template-1.zip',
            artifactSha256: 'a'.repeat(64),
            status: 'ready',
            referenceId: 'ref-template',
            attemptCount: 4,
            updatedAt: new Date(),
          }),
          updateTemplateAttachment: vi.fn(),
          updateWebsiteStatus,
        },
        attachTemplate: vi.fn(),
      }),
    ).resolves.toEqual({ referenceId: 'ref-template' });

    expect(updateWebsiteStatus).toHaveBeenCalledWith('website-1', WEBSITE_AUTHORIZATION_REQUIRED);
  });

  it('does not update website state when atomic finalization loses its CAS', async () => {
    const updateWebsiteStatus = vi.fn();
    const finalize = vi.fn(async () => false);

    await expect(
      retryTemplateAttachment('website-1', {
        workspaceId: 'workspace-1',
        store: {
          findTemplateAttachment: async () => ({
            templateId: 'template-1',
            artifactStorageKey: 'template-1.zip',
            artifactSha256: 'a'.repeat(64),
            status: 'failed',
            referenceId: null,
            attemptCount: 3,
            updatedAt: new Date(),
          }),
          updateTemplateAttachment: vi.fn(async () => 4),
          finalizeTemplateAttachment: finalize,
          updateWebsiteStatus,
        },
        attachTemplate: async () => ({ referenceId: 'ref-template' }),
      }),
    ).rejects.toThrow('模板应用已被其他任务接管');

    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ expectedAttemptCount: 4, status: 'ready' }),
    );
    expect(updateWebsiteStatus).not.toHaveBeenCalled();
  });

  it('retains records and marks a definite runtime failure', async () => {
    const update = vi.fn(async () => undefined);
    const result = await createWebsite('站点', {
      ownerId: 'user-1',
      store: store({ updateWebsiteStatus: update }),
      runtime: () => ({
        create: vi.fn(async () => {
          throw new WorkspaceClientError('RUNNER_UNAVAILABLE', 'runner unavailable');
        }),
        status: vi.fn(),
        bootstrap: vi.fn(),
        reconcileBootstrap: vi.fn(),
        configureAuthorization: vi.fn(),
        verifyAuthorization: vi.fn(),
      }),
    });
    expect(result.website.status).toBe(WEBSITE_PROVISIONING_FAILED);
    expect(update).toHaveBeenCalledWith(expect.any(String), WEBSITE_PROVISIONING_FAILED);
  });

  it('reconciles an unknown create result through runtime status', async () => {
    const update = vi.fn(async () => undefined);
    const status = vi.fn(async () => ({ status: 'running' }));
    const result = await createWebsite('站点', {
      ownerId: 'user-1',
      store: store({ updateWebsiteStatus: update }),
      runtime: () => ({
        create: vi.fn(async () => {
          throw new WorkspaceClientError('UNKNOWN_RESULT', 'outcome unknown');
        }),
        status,
        bootstrap: vi.fn(async () => ({ status: 'INITIALIZED' })),
        reconcileBootstrap: vi.fn(),
        configureAuthorization: vi.fn(),
        verifyAuthorization: vi.fn(),
      }),
    });
    expect(status).toHaveBeenCalledOnce();
    expect(result.website.status).toBe(WEBSITE_AUTHORIZATION_REQUIRED);
  });

  it('marks bootstrap failure as initialization_failed without retrying', async () => {
    const update = vi.fn(async () => undefined);
    const bootstrap = vi.fn(async () => ({ status: 'FAILED' }));
    const result = await createWebsite('站点', {
      ownerId: 'user-1',
      store: store({ updateWebsiteStatus: update }),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap,
        reconcileBootstrap: vi.fn(),
        configureAuthorization: vi.fn(),
        verifyAuthorization: vi.fn(),
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
      ownerId: 'user-1',
      store: store(),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap,
        reconcileBootstrap,
        configureAuthorization: vi.fn(),
        verifyAuthorization: vi.fn(),
      }),
    });
    expect(result.website.status).toBe(WEBSITE_AUTHORIZATION_REQUIRED);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(reconcileBootstrap).toHaveBeenCalledOnce();
  });

  it('does not expose runtime or credential fields in the public view', async () => {
    const result = await createWebsite('站点', {
      ownerId: 'user-1',
      store: store(),
      runtime: () => ({
        create: vi.fn(async () => ({ status: 'running' })),
        status: vi.fn(),
        bootstrap: vi.fn(async () => ({ status: 'INITIALIZED' })),
        reconcileBootstrap: vi.fn(),
        configureAuthorization: vi.fn(),
        verifyAuthorization: vi.fn(),
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
