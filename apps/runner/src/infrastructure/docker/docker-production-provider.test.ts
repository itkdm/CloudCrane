import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Docker from 'dockerode';
import { switchCurrentRelease, DockerProductionProvider } from './docker-production-provider.js';

const releaseId = 'ded2a9d3-b4bd-4df9-9162-95b1a7b3ac53';

describe('production current release switching', () => {
  it('creates a sibling temporary symlink and renames it over current', async () => {
    const calls: string[] = [];
    await switchCurrentRelease('/production/site', releaseId, {
      symlink: vi.fn(async (target, linkPath) => {
        calls.push(`symlink:${target}:${linkPath}`);
      }),
      rename: vi.fn(async (from, to) => {
        calls.push(`rename:${from}:${to}`);
      }),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^symlink:releases[\\/]ded2a9d3-b4bd-4df9-9162-95b1a7b3ac53:/);
    expect(calls[1]).toMatch(/^rename:/);
    expect(calls[1]).toMatch(/[\\/]current$/);
  });

  it('does not attempt a non-atomic delete when replacing current fails', async () => {
    const renameError = new Error('rename failed');
    const rename = vi.fn(async () => {
      throw renameError;
    });
    await expect(
      switchCurrentRelease('/production/site', releaseId, {
        symlink: vi.fn(async () => undefined),
        rename,
      }),
    ).rejects.toBe(renameError);
    expect(rename).toHaveBeenCalledOnce();
  });
});

describe('DockerProductionProvider', () => {
  it('creates a separate, restricted runtime with a loopback-only random port', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-provider-'));
    const inspect = vi.fn(async () => ({
      Id: 'container-id',
      State: { Running: true },
      NetworkSettings: { Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '43127' }] } },
    }));
    const created = { id: 'container-name', start: vi.fn(), inspect };
    const ownerHelper = {
      start: vi.fn(),
      wait: vi.fn(async () => ({ StatusCode: 0 })),
      remove: vi.fn(async () => undefined),
    };
    const missing = { id: 'cloudcrane-production-00000000-0000-4000-8000-000000000001' };
    const createContainer = vi.fn(async (options: Docker.ContainerCreateOptions) => {
      return (options.Entrypoint ? ownerHelper : created) as unknown as Docker.Container;
    });
    const docker = {
      getContainer: vi.fn(() => ({
        ...missing,
        inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
      })),
      createNetwork: vi.fn(async () => ({ remove: vi.fn() })),
      createContainer,
    } as unknown as Docker;
    const config = {
      runnerId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: path.join(base, 'workspaces'),
      productionRoot: path.join(base, 'production'),
      releaseArtifactRoot: path.join(base, 'releases'),
      managedPbootBaseRoot: path.join(base, 'pboot-base'),
      productionImage: 'cloudcrane-production-pboot:test',
      workspaceImage: 'cloudcrane-workspace-pboot:test',
      daemonPort: 7070,
      cpuLimit: 500_000_000,
      memoryLimitBytes: 268_435_456,
      pidsLimit: 64,
    };
    try {
      const provider = new DockerProductionProvider(config, docker);
      const runtime = await provider.ensureRuntime(
        '00000000-0000-4000-8000-000000000001',
        'production-website',
      );
      expect(runtime).toMatchObject({
        status: 'provisioning',
        productionPort: 43127,
        containerRef: 'container-id',
      });
      const options = createContainer.mock.calls[1]?.[0];
      expect(options?.HostConfig).toMatchObject({
        PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }] },
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        PidsLimit: 64,
      });
      expect(options?.HostConfig?.Binds?.some((bind) => bind.includes('docker.sock'))).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
