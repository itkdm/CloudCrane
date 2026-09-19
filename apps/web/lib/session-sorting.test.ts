import { describe, expect, it } from 'vitest';
import { compareSessionsByActivity, sessionActivityTimestamp } from './session-sorting';

const session = (id: string, values: Partial<Parameters<typeof compareSessionsByActivity>[0]>) => ({
  id,
  createdAt: values.createdAt ?? '2026-09-19T10:00:00.000Z',
  pinnedAt: values.pinnedAt ?? null,
  lastActiveAt: values.lastActiveAt ?? null,
});

describe('session sorting', () => {
  it('sorts pinned sessions before activity, then creation time and id', () => {
    const sessions = [
      session('a', { lastActiveAt: '2026-09-19T12:00:00.000Z' }),
      session('b', {
        lastActiveAt: '2026-09-19T13:00:00.000Z',
        pinnedAt: '2026-09-19T14:00:00.000Z',
      }),
      session('c', { createdAt: '2026-09-19T11:00:00.000Z' }),
    ];

    expect(sessions.sort(compareSessionsByActivity).map(({ id }) => id)).toEqual(['b', 'a', 'c']);
  });

  it('uses createdAt when a new session has no activity', () => {
    const newSession = session('new', { createdAt: '2026-09-19T14:00:00.000Z' });
    expect(sessionActivityTimestamp(newSession)).toBe(Date.parse(newSession.createdAt));
  });

  it('does not let a metadata update timestamp affect activity ordering', () => {
    const active = session('active', { lastActiveAt: '2026-09-19T12:00:00.000Z' });
    const renamed = session('renamed', {
      lastActiveAt: '2026-09-19T11:00:00.000Z',
      createdAt: '2026-09-19T10:00:00.000Z',
    });
    expect([renamed, active].sort(compareSessionsByActivity).map(({ id }) => id)).toEqual([
      'active',
      'renamed',
    ]);
  });
});
