import { describe, expect, it, vi } from 'vitest';
import { ActiveSessionRegistry } from './registry.js';

const disposable = () => ({ dispose: vi.fn(async () => undefined) });

describe('ActiveSessionRegistry', () => {
  it('coalesces concurrent loads and removes rejected loads', async () => {
    const registry = new ActiveSessionRegistry<ReturnType<typeof disposable>>();
    const session = disposable();
    let loads = 0;
    const load = vi.fn(async () => {
      loads += 1;
      return session;
    });
    const [first, second] = await Promise.all([
      registry.getOrLoad('session-1', load),
      registry.getOrLoad('session-1', load),
    ]);
    expect(first).toBe(second);
    expect(loads).toBe(1);

    await registry.close('session-1');
    expect(session.dispose).toHaveBeenCalledOnce();

    const failing = vi.fn(async () => {
      throw new Error('load failed');
    });
    await expect(registry.getOrLoad('session-2', failing)).rejects.toThrow('load failed');
    expect(registry.size).toBe(0);
    await expect(registry.getOrLoad('session-2', async () => disposable())).resolves.toBeDefined();
  });
});
