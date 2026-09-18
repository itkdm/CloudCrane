import { describe, expect, it } from 'vitest';
import {
  assertSameOrigin,
  assertWebsiteAccessForUser,
  AuthorizationError,
  headersFromNode,
  requireSession,
} from './index.js';

describe('CloudCrane authorization primitives', () => {
  it('rejects anonymous, expired, or revoked sessions before resource access', async () => {
    const auth = {
      api: { getSession: async () => null },
    } as never;

    await expect(requireSession(auth, { cookie: 'expired-or-revoked' })).rejects.toEqual(
      new AuthorizationError('AUTHENTICATION_REQUIRED', 'authentication required', 401),
    );
  });

  it('rejects banned users even when Better Auth returns a session', async () => {
    const auth = {
      api: { getSession: async () => ({ user: { id: 'user-a', banned: true } }) },
    } as never;

    await expect(requireSession(auth, {})).rejects.toEqual(
      new AuthorizationError('ACCOUNT_BANNED', 'account is unavailable', 403),
    );
  });

  it('rejects cross-origin state changes', () => {
    expect(() =>
      assertSameOrigin({ origin: 'https://evil.example' }, 'http://localhost:3000'),
    ).toThrowError(new AuthorizationError('ORIGIN_NOT_ALLOWED', 'origin is not allowed', 403));
    expect(() =>
      assertSameOrigin({ origin: 'http://localhost:3000' }, 'http://localhost:3000'),
    ).not.toThrow();
  });

  it('uses the deployment Web Origin when checking same-origin requests', () => {
    const previousWebOrigin = process.env.WEB_ORIGIN;
    const previousPublicWebOrigin = process.env.NEXT_PUBLIC_WEB_ORIGIN;
    const previousAuthUrl = process.env.BETTER_AUTH_URL;
    process.env.WEB_ORIGIN = 'https://app.example.com';
    delete process.env.NEXT_PUBLIC_WEB_ORIGIN;
    delete process.env.BETTER_AUTH_URL;

    try {
      expect(() => assertSameOrigin({ origin: 'https://app.example.com' })).not.toThrow();
      expect(() => assertSameOrigin({ origin: 'http://localhost:3000' })).toThrow(
        'origin is not allowed',
      );
    } finally {
      if (previousWebOrigin === undefined) delete process.env.WEB_ORIGIN;
      else process.env.WEB_ORIGIN = previousWebOrigin;
      if (previousPublicWebOrigin === undefined) delete process.env.NEXT_PUBLIC_WEB_ORIGIN;
      else process.env.NEXT_PUBLIC_WEB_ORIGIN = previousPublicWebOrigin;
      if (previousAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = previousAuthUrl;
    }
  });

  it('normalizes Node headers without losing cookies', () => {
    expect(
      headersFromNode({ cookie: ['a=1', 'b=2'], origin: 'http://localhost:3000' }).get('cookie'),
    ).toBe('a=1; b=2');
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
