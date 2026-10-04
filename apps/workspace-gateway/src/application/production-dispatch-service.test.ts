import { describe, expect, it, vi } from 'vitest';
import { ProductionDispatchService } from './production-dispatch-service.js';

describe('ProductionDispatchService CMS audit', () => {
  it('stores changed field names and record identity without CMS field values', async () => {
    const store = {
      createAuditEvent: vi.fn().mockResolvedValue('audit-1'),
      finishAuditEvent: vi.fn().mockResolvedValue(undefined),
      findWorkspace: vi.fn().mockResolvedValue({ runnerId: 'runner-1' }),
      findAvailableRunner: vi.fn().mockResolvedValue({
        runnerId: 'runner-1',
        capabilities: ['cms.company.update'],
      }),
    };
    const registry = {
      get: vi.fn(),
      online: vi.fn().mockReturnValue(true),
      dispatch: vi.fn().mockResolvedValue({
        type: 'runner.completed',
        requestId: '00000000-0000-4000-8000-000000000011',
        traceId: '00000000-0000-4000-8000-000000000012',
        result: { phone: '13800000000' },
        durationMs: 5,
      }),
    };
    const service = new ProductionDispatchService(store as never, registry as never);
    const operation = {
      operation: 'cms.company.update' as const,
      payload: {
        expectedVersion: 'a'.repeat(64),
        patch: { phone: '13800000000', email: 'private@example.test' },
      },
      requestId: '00000000-0000-4000-8000-000000000011',
      traceId: '00000000-0000-4000-8000-000000000012',
      websiteId: '00000000-0000-4000-8000-000000000013',
      workspaceId: '00000000-0000-4000-8000-000000000014',
      agentRunId: '00000000-0000-4000-8000-000000000015',
      toolCallId: 'call-16',
      deadlineMs: 120_000,
    };

    await expect(service.execute(operation)).resolves.toEqual({ phone: '13800000000' });
    const [, audit] = store.finishAuditEvent.mock.calls[0]!;
    expect(audit).toMatchObject({
      status: 'SUCCESS',
      resultSummary: {
        action: 'cms.company.update',
        recordId: 'company',
        changedFields: 'phone,email',
      },
    });
    expect(JSON.stringify(audit)).not.toContain('13800000000');
    expect(JSON.stringify(audit)).not.toContain('private@example.test');
  });

  it('audits CMS content creation with category, field names, and created row ID only', async () => {
    const store = {
      createAuditEvent: vi.fn().mockResolvedValue('audit-create'),
      finishAuditEvent: vi.fn().mockResolvedValue(undefined),
      findWorkspace: vi.fn().mockResolvedValue({ runnerId: 'runner-1' }),
      findAvailableRunner: vi.fn().mockResolvedValue({
        runnerId: 'runner-1',
        capabilities: ['cms.content.create'],
      }),
    };
    const registry = {
      get: vi.fn(),
      online: vi.fn().mockReturnValue(true),
      dispatch: vi.fn().mockResolvedValue({
        type: 'runner.completed',
        requestId: '00000000-0000-4000-8000-000000000031',
        traceId: '00000000-0000-4000-8000-000000000032',
        result: {
          item: { id: '88', title: 'Private title' },
          workspaceContentStale: true,
          replayed: false,
        },
        durationMs: 5,
      }),
    };
    const service = new ProductionDispatchService(store as never, registry as never);
    const operation = {
      operation: 'cms.content.create' as const,
      payload: { categoryCode: 'news01', title: 'Private title', content: 'Private body' },
      idempotencyKey: 'create-key-1',
      requestId: '00000000-0000-4000-8000-000000000031',
      traceId: '00000000-0000-4000-8000-000000000032',
      websiteId: '00000000-0000-4000-8000-000000000033',
      workspaceId: '00000000-0000-4000-8000-000000000034',
      deadlineMs: 120_000,
    };

    await service.execute(operation);
    const [, audit] = store.finishAuditEvent.mock.calls[0]!;
    expect(audit).toMatchObject({
      status: 'SUCCESS',
      resultSummary: {
        action: 'cms.content.create',
        categoryCode: 'news01',
        recordId: '88',
        changedFields: 'title,content',
      },
    });
    expect(JSON.stringify(audit)).not.toContain('Private title');
    expect(JSON.stringify(audit)).not.toContain('Private body');
  });

  it('audits media upload metadata without recording attachment bytes or identity', async () => {
    const store = {
      createAuditEvent: vi.fn().mockResolvedValue('audit-media'),
      finishAuditEvent: vi.fn().mockResolvedValue(undefined),
      findWorkspace: vi.fn().mockResolvedValue({ runnerId: 'runner-1' }),
      findAvailableRunner: vi.fn().mockResolvedValue({
        runnerId: 'runner-1',
        capabilities: ['cms.media.upload'],
      }),
    };
    const registry = {
      get: vi.fn(),
      online: vi.fn().mockReturnValue(true),
      dispatch: vi.fn().mockResolvedValue({
        type: 'runner.completed',
        requestId: '00000000-0000-4000-8000-000000000041',
        traceId: '00000000-0000-4000-8000-000000000042',
        result: {
          path: '/static/upload/image/cloudcrane/aa/file.png',
          size: 512,
          mimeType: 'image/png',
          contentSha256: 'b'.repeat(64),
          workspaceContentStale: true,
          replayed: false,
        },
        durationMs: 5,
      }),
    };
    const service = new ProductionDispatchService(store as never, registry as never);
    const operation = {
      operation: 'cms.media.upload' as const,
      payload: {
        attachmentId: '00000000-0000-4000-8000-000000000043',
        mimeType: 'image/png' as const,
        contentSha256: 'c'.repeat(64),
        contentBase64: 'private image bytes',
      },
      idempotencyKey: 'media-key-1',
      requestId: '00000000-0000-4000-8000-000000000041',
      traceId: '00000000-0000-4000-8000-000000000042',
      websiteId: '00000000-0000-4000-8000-000000000044',
      workspaceId: '00000000-0000-4000-8000-000000000045',
      deadlineMs: 120_000,
    };

    await service.execute(operation);
    const [, audit] = store.finishAuditEvent.mock.calls[0]!;
    expect(audit).toMatchObject({
      status: 'SUCCESS',
      resultSummary: {
        action: 'cms.media.upload',
        mimeType: 'image/png',
        contentSha256: 'c'.repeat(64),
        size: 512,
      },
    });
    expect(JSON.stringify(audit)).not.toContain('private image bytes');
    expect(JSON.stringify(audit)).not.toContain(operation.payload.attachmentId);
  });
});
