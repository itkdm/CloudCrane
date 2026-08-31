import { describe, expect, it } from 'vitest';
import { deriveSessionTitle } from './session-title.js';

describe('deriveSessionTitle', () => {
  it('extracts a concise Chinese website task title', () => {
    expect(
      deriveSessionTitle('请先检查一下当前首页，然后把首页标题改成蓝色，并检查页面修改结果。'),
    ).toBe('修改首页标题');
  });

  it('normalizes markdown and whitespace before truncating', () => {
    expect(deriveSessionTitle('帮我 **检查**\n首页内容和导航栏布局')).toBe(
      '检查 首页内容和导航栏布局',
    );
  });

  it('keeps a readable English title within the product limit', () => {
    const title = deriveSessionTitle(
      'Please inspect the current homepage and explain what should be improved before making changes.',
    );
    expect(title.length).toBeLessThanOrEqual(56);
    expect(title).not.toBe('新对话');
  });

  it('never returns an empty title', () => {
    expect(deriveSessionTitle('   ***   ')).toBe('新对话');
  });
});
