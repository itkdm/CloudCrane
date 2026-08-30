import { describe, expect, it, vi } from 'vitest';
import Docker from 'dockerode';
import { DockerWorkspaceProvider } from './docker-workspace-provider.js';

const config = {
  runnerId: 'test-runner',
  workspaceRoot: '/tmp/cloudcrane',
  workspaceImage: 'test-image',
  daemonPort: 7070,
  cpuLimit: 1_000_000,
  memoryLimitBytes: 128,
  pidsLimit: 32,
};

describe('DockerWorkspaceProvider orchestration', () => {
  it('rejects values that are not UUID workspace ids', async () => {
    const docker = { createNetwork: vi.fn() } as unknown as Docker;
    await expect(new DockerWorkspaceProvider(config, docker).create('--------')).rejects.toThrow(
      'Invalid internal workspace id',
    );
    expect(docker.createNetwork).not.toHaveBeenCalled();
  });

  it('removes the container and network when start fails', async () => {
    const networkRemove = vi.fn().mockResolvedValue(undefined);
    const containerRemove = vi.fn().mockResolvedValue(undefined);
    const ownerRemove = vi.fn().mockResolvedValue(undefined);
    const fakeDocker = {
      createNetwork: vi.fn().mockResolvedValue({ id: 'network-1', remove: networkRemove }),
      createContainer: vi
        .fn()
        .mockResolvedValueOnce({
          start: vi.fn().mockResolvedValue(undefined),
          wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
          remove: ownerRemove,
        })
        .mockResolvedValueOnce({
          id: 'container-1',
          start: vi.fn().mockRejectedValue(new Error('start failed')),
          remove: containerRemove,
        }),
    } as unknown as Docker;
    await expect(
      new DockerWorkspaceProvider(config, fakeDocker).create(
        '00000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toThrow('start failed');
    expect(containerRemove).toHaveBeenCalledWith({ force: true });
    expect(ownerRemove).toHaveBeenCalledWith({ force: true });
    expect(networkRemove).toHaveBeenCalledOnce();
  });
});
