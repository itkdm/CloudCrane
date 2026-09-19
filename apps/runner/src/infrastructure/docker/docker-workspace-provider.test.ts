import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Docker from 'dockerode';
import { DockerWorkspaceProvider } from './docker-workspace-provider.js';

vi.mock('../../daemon/workspace-daemon-client.js', () => ({
  WorkspaceDaemonClient: class {
    async runtimeInfo() {
      return { preview: { status: 'ready' } };
    }
    async health() {
      return { status: 'ok' };
    }
  },
}));

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

  it('recreates an old runtime when the reference bind is missing', async () => {
    const referenceRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-reference-root-'));
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const persistentPath = `${config.workspaceRoot}/${workspaceId}/workspace`;
    const oldNetworkRemove = vi.fn().mockResolvedValue(undefined);
    const oldContainer = {
      id: 'old-container',
      inspect: vi.fn().mockResolvedValue({
        Config: { Image: config.workspaceImage },
        HostConfig: {
          NetworkMode: 'old-network',
          Privileged: false,
          PidMode: '',
          IpcMode: 'private',
          SecurityOpt: ['no-new-privileges:true'],
        },
        Mounts: [{ Source: persistentPath, Destination: '/workspace', RW: true }],
        State: { Running: true },
      }),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const replacementContainer = {
      id: 'replacement-container',
      inspect: vi.fn().mockResolvedValue({
        Config: { Image: config.workspaceImage },
        HostConfig: {
          NetworkMode: 'replacement-network',
          Privileged: false,
          PidMode: '',
          IpcMode: 'private',
          SecurityOpt: ['no-new-privileges:true'],
        },
        Mounts: [
          { Source: persistentPath, Destination: '/workspace', RW: true },
          {
            Source: `${referenceRoot}/${workspaceId}`,
            Destination: '/workspace/.cloudcrane/references',
            RW: false,
          },
        ],
        State: { Running: true },
        NetworkSettings: {
          Ports: {
            '7070/tcp': [{ HostPort: '37070' }],
            '8080/tcp': [{ HostPort: '38080' }],
          },
        },
      }),
      start: vi.fn().mockResolvedValue(undefined),
    };
    let activeContainer: typeof oldContainer | typeof replacementContainer = oldContainer;
    oldContainer.remove.mockImplementation(async () => {
      activeContainer = replacementContainer;
    });
    const fakeDocker = {
      getContainer: vi.fn(() => activeContainer),
      getNetwork: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Name: `cloudcrane-workspace-${workspaceId}`,
        }),
        remove: oldNetworkRemove,
      }),
      createNetwork: vi.fn().mockResolvedValue({ id: 'replacement-network' }),
      createContainer: vi
        .fn()
        .mockResolvedValueOnce({
          start: vi.fn().mockResolvedValue(undefined),
          wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
          remove: vi.fn().mockResolvedValue(undefined),
        })
        .mockResolvedValueOnce(replacementContainer),
    } as unknown as Docker;
    const provider = new DockerWorkspaceProvider({ ...config, referenceRoot }, fakeDocker);
    const createReplacement = vi.spyOn(provider, 'create').mockResolvedValue({
      workspaceId,
      containerRef: 'replacement-container',
      status: 'running',
    });

    try {
      const runtime = await provider.getStatus(workspaceId);
      expect(runtime.containerRef).toBe('replacement-container');
      expect(oldContainer.stop).toHaveBeenCalledOnce();
      expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
      expect(oldNetworkRemove).toHaveBeenCalledOnce();
      expect(createReplacement).toHaveBeenCalledWith(workspaceId);
    } finally {
      await rm(referenceRoot, { recursive: true, force: true });
    }
  });
});
