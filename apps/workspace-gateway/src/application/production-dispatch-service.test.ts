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
});
