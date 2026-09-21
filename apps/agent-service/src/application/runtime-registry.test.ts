import { describe, expect, it, vi } from 'vitest';
import type { WebsiteAgentRuntime } from '@cloudcrane/website-agent';
import { AgentServiceError } from './errors.js';
import { WebsiteRuntimeRegistry } from './runtime-registry.js';

const binding = {
  websiteId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  websiteStatus: 'ACTIVE',
  workspaceStatus: 'running',
};

describe('WebsiteRuntimeRegistry', () => {
  it('coalesces concurrent runtime creation per website', async () => {
    const recoverStaleRuns = vi.fn(async () => undefined);
    const createRuntime = vi.fn(
      async () => ({ shutdown: vi.fn(), recoverStaleRuns }) as unknown as WebsiteAgentRuntime,
    );
    const registry = new WebsiteRuntimeRegistry({
      bindingStore: { findWebsiteWorkspace: vi.fn(async () => binding) },
      createRuntime,
    });
    const [first, second] = await Promise.all([
      registry.get(binding.websiteId),
      registry.get(binding.websiteId),
    ]);
    expect(first).toBe(second);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(recoverStaleRuns).toHaveBeenCalledTimes(1);
  });

  it('returns structured readiness errors and removes failed entries', async () => {
    const registry = new WebsiteRuntimeRegistry({
      bindingStore: {
        findWebsiteWorkspace: vi.fn(async () => ({ ...binding, workspaceStatus: 'stopped' })),
      },
      createRuntime: vi.fn(),
    });
    await expect(registry.get(binding.websiteId)).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_READY',
    } satisfies Partial<AgentServiceError>);
    expect(registry.size).toBe(0);
  });

  it('shuts down a runtime when stale-run recovery fails', async () => {
    const shutdown = vi.fn(async () => undefined);
    const registry = new WebsiteRuntimeRegistry({
      bindingStore: { findWebsiteWorkspace: vi.fn(async () => binding) },
      createRuntime: vi.fn(async () => ({
        shutdown,
        recoverStaleRuns: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      }) as unknown as WebsiteAgentRuntime),
    });

    await expect(registry.get(binding.websiteId)).rejects.toThrow('database unavailable');
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });
});
