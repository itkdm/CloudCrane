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
    const createRuntime = vi.fn(
      async () => ({ shutdown: vi.fn() }) as unknown as WebsiteAgentRuntime,
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
});
