import { describe, expect, it, vi } from 'vitest';
import { finalizeProductionRefreshAuditSafely } from './production-refresh-audit.js';

describe('Production refresh audit finalization', () => {
  it('reports an audit failure without failing the completed business operation', async () => {
    const auditError = new Error('audit database unavailable');
    const finalize = vi.fn().mockRejectedValue(auditError);
    const reportFailure = vi.fn();

    await expect(
      finalizeProductionRefreshAuditSafely(finalize, reportFailure),
    ).resolves.toBeUndefined();
    expect(reportFailure).toHaveBeenCalledWith(auditError);
  });
});
