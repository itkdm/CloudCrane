import { describe, expect, it } from 'vitest';
import { envelopeSchema, processExecRequestSchema, workspaceErrorCodeSchema } from './index.js';

describe('workspace envelope', () => {
  it('accepts the shared envelope fields', () => {
    const result = envelopeSchema.parse({
      type: 'health.check',
      requestId: 'req-1',
      websiteId: 'site-1',
      timestamp: '2026-08-30T00:00:00.000Z',
      payload: { ok: true },
    });

    expect(result.type).toBe('health.check');
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('rejects an envelope without a website id', () => {
    expect(() =>
      envelopeSchema.parse({
        type: 'health.check',
        requestId: 'req-1',
        timestamp: new Date(),
        payload: null,
      }),
    ).toThrow();
  });

  it('validates runtime contracts and standard errors', () => {
    expect(workspaceErrorCodeSchema.parse('FILE_CHANGED')).toBe('FILE_CHANGED');
    expect(
      processExecRequestSchema.parse({
        command: 'php',
        executionId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toMatchObject({ cwd: '/workspace', timeoutMs: 120000 });
  });
});
