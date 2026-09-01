import { describe, expect, it, vi } from 'vitest';
import { copyTextWithFallback, PBOOT_AUTHORIZATION_URL } from './website-authorization.js';

describe('website authorization UI helpers', () => {
  it('keeps the official authorization URL on HTTPS', () => {
    expect(PBOOT_AUTHORIZATION_URL).toBe('https://www.pbootcms.com/freesn/');
  });

  it('uses the clipboard API when available', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyTextWithFallback('https://preview.example')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://preview.example');
    vi.unstubAllGlobals();
  });

  it('falls back cleanly when clipboard APIs are unavailable', async () => {
    const remove = vi.fn();
    const textarea = {
      value: '',
      style: {} as CSSStyleDeclaration,
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove,
    };
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('document', {
      execCommand: vi.fn(() => true),
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn() },
    });

    await expect(copyTextWithFallback('https://preview.example')).resolves.toBe(true);
    expect(textarea.value).toBe('https://preview.example');
    expect(textarea.select).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
