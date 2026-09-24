import { describe, expect, it, vi } from 'vitest';
import { DrizzleAttachmentQuotaService } from './attachment-quota.js';

describe('DrizzleAttachmentQuotaService cleanup', () => {
  it('updates expired reservations and their operations in bounded SQL statements', async () => {
    const expired = [
      { operationId: 'operation-1' },
      { operationId: 'operation-1' },
      { operationId: 'operation-2' },
    ];
    const reservationReturning = vi.fn(async () => expired);
    const reservationWhere = vi.fn(() => ({ returning: reservationReturning }));
    const reservationSet = vi.fn(() => ({ where: reservationWhere }));
    const operationWhere = vi.fn(async () => undefined);
    const operationSet = vi.fn(() => ({ where: operationWhere }));
    const update = vi
      .fn()
      .mockReturnValueOnce({ set: reservationSet })
      .mockReturnValueOnce({ set: operationSet });
    const transaction = vi.fn(async (run: (tx: { update: typeof update }) => Promise<void>) =>
      run({ update }),
    );
    const service = new DrizzleAttachmentQuotaService({ transaction } as never);

    await service.cleanupExpiredReservations(new Date('2026-09-24T00:00:00.000Z'));

    expect(transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2);
    expect(operationWhere).toHaveBeenCalledOnce();
  });
});
