import { describe, expect, it } from 'vitest';
import { isWebsiteStatus } from './website-status';

describe('website status presentation boundary', () => {
  it('recognizes API status identifiers without translating them', () => {
    expect(isWebsiteStatus('ready')).toBe(true);
    expect(isWebsiteStatus('已准备')).toBe(false);
    expect(isWebsiteStatus('unexpected')).toBe(false);
  });
});
