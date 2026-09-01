import { describe, expect, it } from 'vitest';
import { normalizePbootAuthorization } from './pboot-authorization.js';

describe('Pboot authorization input', () => {
  it('normalizes pasted comma-separated official codes without guessing their format', () => {
    expect(normalizePbootAuthorization('  first ， second, , third  ')).toBe('first,second,third');
  });

  it('rejects empty and oversized values', () => {
    expect(() => normalizePbootAuthorization('， , ')).toThrow('不能为空');
    expect(() => normalizePbootAuthorization('x'.repeat(2049))).toThrow('2KB');
  });
});
