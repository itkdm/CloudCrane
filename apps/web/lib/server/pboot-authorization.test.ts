import { describe, expect, it } from 'vitest';
import {
  canConfigurePbootAuthorization,
  normalizePbootAuthorization,
  PBOOT_AUTHORIZATION_REQUIRED,
} from './pboot-authorization.js';

describe('Pboot authorization input', () => {
  it('normalizes pasted comma-separated official codes without guessing their format', () => {
    expect(normalizePbootAuthorization('  first ， second, , third  ')).toBe('first,second,third');
  });

  it('rejects empty and oversized values', () => {
    expect(() => normalizePbootAuthorization('， , ')).toThrow('不能为空');
    expect(() => normalizePbootAuthorization('x'.repeat(2049))).toThrow('2KB');
  });

  it('only allows authorization while the website is awaiting authorization', () => {
    expect(canConfigurePbootAuthorization(PBOOT_AUTHORIZATION_REQUIRED)).toBe(true);
    expect(canConfigurePbootAuthorization('ready')).toBe(false);
    expect(canConfigurePbootAuthorization('deleting')).toBe(false);
  });
});
