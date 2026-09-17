import { describe, expect, it } from 'vitest';
import { assertSameOrigin, AuthorizationError, headersFromNode } from './index.js';

describe('CloudCrane authorization primitives', () => {
  it('rejects cross-origin state changes', () => {
    expect(() => assertSameOrigin({ origin: 'https://evil.example' }, 'http://localhost:3000')).toThrowError(
      new AuthorizationError('ORIGIN_NOT_ALLOWED', 'origin is not allowed', 403),
    );
    expect(() => assertSameOrigin({ origin: 'http://localhost:3000' }, 'http://localhost:3000')).not.toThrow();
  });

  it('normalizes Node headers without losing cookies', () => {
    expect(headersFromNode({ cookie: ['a=1', 'b=2'], origin: 'http://localhost:3000' }).get('cookie')).toBe('a=1, b=2');
  });
});
