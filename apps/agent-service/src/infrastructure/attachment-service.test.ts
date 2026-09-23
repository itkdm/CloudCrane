import { describe, expect, it, vi } from 'vitest';
import { ConversationAttachmentService } from './attachment-service.js';

const row = {
  id: '00000000-0000-4000-8000-000000000001',
  ownerId: 'user-1',
  websiteId: '00000000-0000-4000-8000-000000000002',
  sessionId: '00000000-0000-4000-8000-000000000003',
  storageKey: 'attachments/user-1/site/session/file/blob',
};

function dbForRemove() {
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  }));
  return {
    db: {
      query: { conversationAttachment: { findFirst: vi.fn(async () => row) } },
      update,
    } as never,
    update,
  };
}

function dbForCleanup(claimRowCount: number, finalRowCount = 1) {
  const updateResults = [{ rowCount: claimRowCount }, { rowCount: finalRowCount }];
  const updates: Array<{ set: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> }> = [];
  const update = vi.fn(() => {
    const set = vi.fn(() => {
      const where = vi.fn(async () => updateResults.shift() ?? { rowCount: 0 });
      const chain = { where };
      updates.push({ set, where });
      return chain;
    });
    return { set };
  });
  return {
    db: {
      query: {
        conversationAttachment: {
          findMany: vi.fn(async () => [{ ...row, expiresAt: new Date(0) }]),
        },
      },
      update,
    } as never,
    update,
    updates,
  };
}

describe('ConversationAttachmentService cleanup boundaries', () => {
  it('does not mark metadata deleted when object deletion fails', async () => {
    const { db, update } = dbForRemove();
    const storage = {
      delete: vi.fn(async () => {
        throw new Error('OSS unavailable');
      }),
    } as never;
    const service = new ConversationAttachmentService(db, storage, 'oss', 20 * 1024 * 1024);

    await expect(service.remove(row.id, row.ownerId)).rejects.toThrow('OSS unavailable');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not delete an object when another worker wins the expiry claim', async () => {
    const { db, update } = dbForCleanup(0);
    const storage = { delete: vi.fn(async () => undefined) };
    const service = new ConversationAttachmentService(
      db,
      storage as never,
      'oss',
      20 * 1024 * 1024,
    );

    await service.cleanupExpired(new Date(1));

    expect(update).toHaveBeenCalledTimes(1);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('marks a successfully deleted object only after it was claimed', async () => {
    const { db, update, updates } = dbForCleanup(1);
    const storage = { delete: vi.fn(async () => undefined) };
    const service = new ConversationAttachmentService(
      db,
      storage as never,
      'oss',
      20 * 1024 * 1024,
    );

    await service.cleanupExpired(new Date(1));

    expect(update).toHaveBeenCalledTimes(2);
    expect(storage.delete).toHaveBeenCalledWith(row.storageKey);
    expect(updates[1]?.set).toHaveBeenCalledWith({ status: 'deleted', deletedAt: new Date(1) });
  });

  it('returns failed object cleanup to ready so a later run can retry', async () => {
    const { db, update, updates } = dbForCleanup(1);
    const storage = {
      delete: vi.fn(async () => {
        throw new Error('temporary storage outage');
      }),
    };
    const service = new ConversationAttachmentService(
      db,
      storage as never,
      'oss',
      20 * 1024 * 1024,
    );

    await service.cleanupExpired(new Date(1));

    expect(update).toHaveBeenCalledTimes(2);
    expect(updates[1]?.set).toHaveBeenCalledWith({
      status: 'ready',
      errorCode: 'STORAGE_DELETE_FAILED',
    });
  });
});
