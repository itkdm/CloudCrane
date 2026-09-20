import { describe, expect, it, vi } from 'vitest';
import { finishAuditEvent, insertAuditEvent, sanitizeAuditSummary } from './audit.js';

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

  it('retries a transient finalization failure once', async () => {
    const returning = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce([{ id: 'audit-1' }]);
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning })),
        })),
      })),
    } as never;

    await expect(
      finishAuditEvent(db, 'audit-1', { status: 'SUCCESS', durationMs: 10 }),
    ).resolves.toBeUndefined();
    expect(returning).toHaveBeenCalledTimes(2);
  });

  it('treats an already-finalized event with the same status as success', async () => {
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ status: 'SUCCESS' }]) })),
        })),
      })),
    } as never;

    await expect(finishAuditEvent(db, 'audit-1', { status: 'SUCCESS' })).resolves.toBeUndefined();
  });

  it('rejects when an event is already finalized with a different status', async () => {
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ status: 'FAILED' }]) })),
        })),
      })),
    } as never;

    await expect(finishAuditEvent(db, 'audit-1', { status: 'SUCCESS' })).rejects.toThrow(
      'audit event is missing or already finalized',
    );
  });

  it('fails after both finalization attempts fail', async () => {
    const returning = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning })),
        })),
      })),
    } as never;

    await expect(finishAuditEvent(db, 'audit-1', { status: 'UNKNOWN' })).rejects.toThrow(
      'database unavailable',
    );
    expect(returning).toHaveBeenCalledTimes(2);
  });
});
