import { describe, expect, it } from 'vitest';
import { canEnterWorkspace } from './website-session-loading';

describe('canEnterWorkspace', () => {
  it('only allows ready websites to load agent sessions', () => {
    expect(canEnterWorkspace({ status: 'ready' })).toBe(true);
    expect(canEnterWorkspace({ status: 'authorization_required' })).toBe(false);
    expect(canEnterWorkspace({ status: 'template_attach_failed' })).toBe(false);
    expect(canEnterWorkspace({ status: 'initializing' })).toBe(false);
    expect(canEnterWorkspace(undefined)).toBe(false);
  });
});
