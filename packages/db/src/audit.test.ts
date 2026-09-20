import { describe, expect, it, vi } from 'vitest';
import { insertAuditEvent, sanitizeAuditSummary } from './audit.js';

describe('audit summary safety', () => {
  it('keeps only short scalar, non-sensitive metadata', () => {
    const result = sanitizeAuditSummary({
      operation: 'runtime.create',
      status: 'succeeded',
      durationMs: 42,
      authorization: 'SUPER_SECRET_TEST_VALUE',
      prompt: 'SUPER_SECRET_TEST_VALUE',
      toolOutput: 'SUPER_SECRET_TEST_VALUE',
      command: 'cat secret.txt',
      environment: 'SUPER_SECRET_TEST_VALUE',
      nested: { content: 'must not be stored' },
      arbitraryField: 'must not be stored',
      nonFinite: Number.NaN,
    });

    expect(result).toEqual({
      operation: 'runtime.create',
      status: 'succeeded',
      durationMs: 42,
    });
    expect(JSON.stringify(result)).not.toContain('SUPER_SECRET_TEST_VALUE');
  });

  it('sets the terminal timestamp for an immediate terminal audit event', async () => {
    const values = vi.fn((input: Record<string, unknown>) => {
      expect(input.status).toBe('FAILED');
      expect(input.finishedAt).toBeInstanceOf(Date);
      return { returning: async () => [{ id: 'audit-1' }] };
    });
    const db = { insert: vi.fn(() => ({ values })) } as never;

    await expect(
      insertAuditEvent(db, {
        actorType: 'user',
        operation: 'auth.authorization.denied',
        status: 'FAILED',
        errorCode: 'WEBSITE_FORBIDDEN',
      }),
    ).resolves.toBe('audit-1');
  });
});
