import { describe, expect, it } from 'vitest';
import {
  assertSameOrigin,
  assertWebsiteAccessForUser,
  AuthorizationError,
  headersFromNode,
} from './index.js';

describe('CloudCrane authorization primitives', () => {
  it('rejects cross-origin state changes', () => {
    expect(() =>
      assertSameOrigin({ origin: 'https://evil.example' }, 'http://localhost:3000'),
    ).toThrowError(new AuthorizationError('ORIGIN_NOT_ALLOWED', 'origin is not allowed', 403));
    expect(() =>
      assertSameOrigin({ origin: 'http://localhost:3000' }, 'http://localhost:3000'),
    ).not.toThrow();
  });

  it('normalizes Node headers without losing cookies', () => {
    expect(
      headersFromNode({ cookie: ['a=1', 'b=2'], origin: 'http://localhost:3000' }).get('cookie'),
    ).toBe('a=1, b=2');
  });

  it('allows the owner and an explicit admin override', async () => {
    const db = {
      query: {
        website: {
          findFirst: async () => ({ id: 'website-a', ownerId: 'user-a' }),
        },
      },
    } as never;

    await expect(
      assertWebsiteAccessForUser(db, 'user-a', undefined, 'website-a'),
    ).resolves.toMatchObject({
      id: 'website-a',
    });
    await expect(
      assertWebsiteAccessForUser(db, 'admin-a', 'admin', 'website-a'),
    ).resolves.toMatchObject({
      id: 'website-a',
    });
  });

  it('denies another user and legacy websites without an owner', async () => {
    const ownedByOther = {
      query: {
        website: {
          findFirst: async () => ({ id: 'website-b', ownerId: 'user-b' }),
        },
      },
    } as never;
    const legacy = {
      query: {
        website: {
          findFirst: async () => ({ id: 'legacy', ownerId: null }),
        },
      },
    } as never;

    await expect(
      assertWebsiteAccessForUser(ownedByOther, 'user-a', 'user', 'website-b'),
    ).rejects.toEqual(
      new AuthorizationError('WEBSITE_FORBIDDEN', 'website access is forbidden', 403),
    );
    await expect(assertWebsiteAccessForUser(legacy, 'user-a', 'user', 'legacy')).rejects.toEqual(
      new AuthorizationError('WEBSITE_FORBIDDEN', 'website access is forbidden', 403),
    );
  });
});
