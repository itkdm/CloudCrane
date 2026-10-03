import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
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
  it.each([
    {
      label: 'ready while Pboot awaits authorization',
      status: 204,
      body: '',
      releaseActivated: true,
    },
    {
      label: 'unavailable runtime probe without activating a Release',
      status: 503,
      body: 'unavailable',
      releaseActivated: false,
    },
  ])(
    'health-checks the canonical host with $label',
    async ({ status, body, releaseActivated }) => {
      const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-health-host-'));
      const websiteId = '00000000-0000-4000-8000-000000000001';
      const currentReleaseId = 'ded2a9d3-b4bd-4df9-9162-95b1a7b3ac53';
      const runtimeRoot = path.join(base, 'production', websiteId);
      await mkdir(path.join(runtimeRoot, 'releases', currentReleaseId), { recursive: true });
      await mkdir(path.join(runtimeRoot, 'shared'), { recursive: true });
      await symlink(
        path.join('releases', currentReleaseId),
        path.join(runtimeRoot, 'current'),
        'dir',
      );

      const container = {
        id: 'container-id',
        inspect: vi.fn(async () => ({
          Id: 'container-id',
          State: { Running: true },
          Config: {
            Labels: {
              'cloudcrane.service': 'production',
              'cloudcrane.website_id': websiteId,
              'cloudcrane.production_slug': 'production-website',
            },
            Image: 'cloudcrane-production-pboot:test',
            User: '1000:1000',
            WorkingDir: '/site',
          },
          HostConfig: {
            RestartPolicy: { Name: 'unless-stopped' },
            PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '43127' }] },
            Binds: ['/production:/site:ro'],
            Privileged: false,
            ReadonlyRootfs: true,
            SecurityOpt: ['no-new-privileges:true'],
            CapDrop: ['ALL'],
            PidsLimit: 64,
          },
          NetworkSettings: { Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '43127' }] } },
        })),
      };
      const docker = { getContainer: vi.fn(() => container) } as unknown as Docker;
      const config = {
        runnerId: '00000000-0000-4000-8000-000000000010',
        workspaceRoot: path.join(base, 'workspaces'),
        productionRoot: path.join(base, 'production'),
        productionHostSuffix: 'sites.example.com',
        releaseArtifactRoot: path.join(base, 'releases'),
        productionKeepReleases: 5,
        productionImage: 'cloudcrane-production-pboot:test',
        workspaceImage: 'website-workspace-pboot:test',
        daemonPort: 7070,
        cpuLimit: 500_000_000,
        memoryLimitBytes: 268_435_456,
        pidsLimit: 64,
      };
      const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const canonicalHost =
          (init?.headers as Record<string, string> | undefined)?.host ===
          'production-website.sites.example.com';
        const responseStatus = canonicalHost ? status : 404;
        return responseStatus === 204
          ? new Response(null, { status: responseStatus })
          : new Response(canonicalHost ? body : 'not found', { status: responseStatus });
      });

      try {
        const runtime = await new DockerProductionProvider(config, docker, fetcher).ensureRuntime(
          websiteId,
          'production-website',
        );

        expect(runtime).toMatchObject({
          status: releaseActivated ? 'authorization_required' : 'provisioning',
          currentReleaseId: releaseActivated ? currentReleaseId : null,
          productionPort: 43127,
        });
        expect(fetcher).toHaveBeenCalledWith(
          'http://127.0.0.1:43127/_cloudcrane/health',
          expect.objectContaining({
            headers: {
              host: 'production-website.sites.example.com',
              'x-forwarded-host': 'production-website.sites.example.com',
              'x-forwarded-proto': 'https',
            },
          }),
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    },
    15_000,
  );

  it('persists the loopback port and reuses it when recreating the runtime', async () => {
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
    const authorizationCheck = {
      start: vi.fn(async () => Readable.from([])),
      inspect: vi.fn(async () => ({ ExitCode: 1 })),
    };
    const missing = {
      id: 'cloudcrane-production-00000000-0000-4000-8000-000000000001',
      exec: vi.fn(async () => authorizationCheck),
    };
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
      productionHostSuffix: 'sites.example.com',
      releaseArtifactRoot: path.join(base, 'releases'),
      productionKeepReleases: 5,
      managedPbootBaseRoot: path.join(base, 'pboot-base'),
      productionImage: 'cloudcrane-production-pboot:test',
      workspaceImage: 'cloudcrane-workspace-pboot:test',
      daemonPort: 7070,
      cpuLimit: 500_000_000,
      memoryLimitBytes: 268_435_456,
      pidsLimit: 64,
    };
    try {
      const provider = new DockerProductionProvider(config, docker, fetch, async () => 43127);
      const runtime = await provider.ensureRuntime(
        '00000000-0000-4000-8000-000000000001',
        'production-website',
      );
      expect(runtime).toMatchObject({
        status: 'provisioning',
        productionPort: 43127,
        containerRef: 'container-id',
      });
      const options = createContainer.mock.calls[0]?.[0];
      expect(options?.HostConfig).toMatchObject({
        PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '43127' }] },
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        PidsLimit: 64,
        RestartPolicy: { Name: 'unless-stopped' },
      });
      expect(options?.WorkingDir).toBe('/site');
      expect(options?.HostConfig?.Binds?.some((bind) => bind.includes('docker.sock'))).toBe(false);
      expect(createContainer).toHaveBeenCalledOnce();
      expect(
        await readFile(
          path.join(base, 'production', '00000000-0000-4000-8000-000000000001', '.production-port'),
          'utf8',
        ),
      ).toBe('43127\n');

      await provider.ensureRuntime('00000000-0000-4000-8000-000000000001', 'production-website');
      expect(createContainer).toHaveBeenCalledTimes(2);
      const recreatedOptions = createContainer.mock.calls[1]?.[0];
      expect(recreatedOptions?.HostConfig?.PortBindings).toEqual({
        '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '43127' }],
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('upgrades a drifted Production image only during per-Website ensure and keeps persistent mounts', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-image-upgrade-'));
    const websiteId = '00000000-0000-4000-8000-000000000001';
    const productionSlug = 'production-website';
    const runtimeRoot = path.join(base, 'production', websiteId);
    const port = 43127;
    const imageTag = 'cloudcrane-production-pboot:test';
    const previousImageId = 'sha256:previous-image';
    const currentImageId = 'sha256:current-image';
    await mkdir(path.join(runtimeRoot, 'releases', releaseId), { recursive: true });
    await mkdir(path.join(runtimeRoot, 'shared'), { recursive: true });
    await symlink(path.join('releases', releaseId), path.join(runtimeRoot, 'current'), 'dir');
    await writeFile(path.join(runtimeRoot, 'shared', '.verified-release'), `${releaseId}\n`);
    await writeFile(path.join(runtimeRoot, '.production-port'), `${port}\n`);

    const containers = new Map<string, { inspect: () => Promise<unknown> }>();
    let previousName = `cloudcrane-production-${websiteId}`;
    let previousRunning = true;
    const inspectInfo = (name: string, imageId: string, running: boolean, boundPort = port) => ({
      Id: `${name}-id`,
      Name: `/${name}`,
      Image: imageId,
      State: { Running: running },
      Config: {
        Labels: {
          'cloudcrane.service': 'production',
          'cloudcrane.website_id': websiteId,
          'cloudcrane.production_slug': productionSlug,
        },
        Image: imageTag,
        User: '1000:1000',
        WorkingDir: '/site',
      },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
        Binds: [
          `${runtimeRoot}:/site:ro`,
          `${path.join(runtimeRoot, 'shared', 'data')}:/site/shared/data:rw`,
          `${path.join(runtimeRoot, 'shared', 'upload')}:/site/shared/upload:rw`,
          `${path.join(runtimeRoot, 'shared', 'config')}:/site/shared/config:rw`,
          `${path.join(runtimeRoot, 'shared', 'runtime')}:/site/shared/runtime:rw`,
        ],
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        PidsLimit: 64,
      },
      NetworkSettings: {
        Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(boundPort) }] },
      },
    });

    const previousContainer = {
      inspect: vi.fn(async () => inspectInfo(previousName, previousImageId, previousRunning)),
      stop: vi.fn(async () => {
        previousRunning = false;
      }),
      start: vi.fn(async () => {
        previousRunning = true;
      }),
      rename: vi.fn(async ({ name }: { name: string }) => {
        containers.delete(previousName);
        previousName = name;
        containers.set(name, previousContainer);
      }),
      remove: vi.fn(async () => {
        containers.delete(previousName);
      }),
    };
    containers.set(previousName, previousContainer);
    const createContainer = vi.fn(async (options: Docker.ContainerCreateOptions) => {
      let running = false;
      const name = options.name ?? 'cloudcrane-production-candidate';
      const candidate = {
        id: `${name}-id`,
        inspect: vi.fn(async () => inspectInfo(name, currentImageId, running)),
        exec: vi.fn(async () => ({
          start: vi.fn(async () => Readable.from([])),
          inspect: vi.fn(async () => ({ ExitCode: 0 })),
        })),
        start: vi.fn(async () => {
          running = true;
        }),
        stop: vi.fn(async () => {
          running = false;
        }),
        remove: vi.fn(async () => {
          containers.delete(name);
        }),
      };
      containers.set(name, candidate);
      return candidate as unknown as Docker.Container;
    });
    const docker = {
      getContainer: vi.fn(
        (name: string) =>
          containers.get(name) ?? {
            inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
          },
      ),
      getImage: vi.fn(() => ({ inspect: vi.fn(async () => ({ Id: currentImageId })) })),
      createContainer,
    } as unknown as Docker;
    const config = {
      runnerId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: path.join(base, 'workspaces'),
      productionRoot: path.join(base, 'production'),
      productionHostSuffix: 'sites.example.com',
      releaseArtifactRoot: path.join(base, 'releases'),
      productionKeepReleases: 5,
      productionImage: imageTag,
      workspaceImage: 'website-workspace-pboot:test',
      daemonPort: 7070,
      cpuLimit: 500_000_000,
      memoryLimitBytes: 268_435_456,
      pidsLimit: 64,
    };
    try {
      const runtime = await new DockerProductionProvider(
        config,
        docker,
        vi.fn(async () => new Response(null, { status: 204 })),
      ).ensureRuntime(websiteId, productionSlug);

      expect(runtime).toMatchObject({
        status: 'authorization_required',
        currentReleaseId: releaseId,
        productionPort: port,
      });
      expect(runtime.containerRef).toBe(`cloudcrane-production-${websiteId}-id`);
      expect(previousContainer.stop).toHaveBeenCalledOnce();
      expect(previousContainer.rename).toHaveBeenCalledWith({
        name: `cloudcrane-production-previous-${websiteId}`,
      });
      expect(previousContainer.remove).toHaveBeenCalledOnce();
      expect(createContainer).toHaveBeenCalledOnce();
      const options = createContainer.mock.calls[0]?.[0];
      expect(options?.HostConfig).toMatchObject({
        Binds: [
          `${runtimeRoot}:/site:ro`,
          `${path.join(runtimeRoot, 'shared', 'data')}:/site/shared/data:rw`,
          `${path.join(runtimeRoot, 'shared', 'upload')}:/site/shared/upload:rw`,
          `${path.join(runtimeRoot, 'shared', 'config')}:/site/shared/config:rw`,
          `${path.join(runtimeRoot, 'shared', 'runtime')}:/site/shared/runtime:rw`,
        ],
        PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
      });
      expect(await readFile(path.join(runtimeRoot, '.production-port'), 'utf8')).toBe(`${port}\n`);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('restores the previous Production container when an updated image fails validation', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-image-rollback-'));
    const websiteId = '00000000-0000-4000-8000-000000000001';
    const productionSlug = 'production-website';
    const runtimeRoot = path.join(base, 'production', websiteId);
    const port = 43127;
    const imageTag = 'cloudcrane-production-pboot:test';
    const previousImageId = 'sha256:previous-image';
    const currentImageId = 'sha256:current-image';
    await mkdir(path.join(runtimeRoot, 'releases', releaseId), { recursive: true });
    await mkdir(path.join(runtimeRoot, 'shared'), { recursive: true });
    await symlink(path.join('releases', releaseId), path.join(runtimeRoot, 'current'), 'dir');
    await writeFile(path.join(runtimeRoot, 'shared', '.verified-release'), `${releaseId}\n`);
    await writeFile(path.join(runtimeRoot, '.production-port'), `${port}\n`);

    const containers = new Map<string, { inspect: () => Promise<unknown> }>();
    let previousName = `cloudcrane-production-${websiteId}`;
    let previousRunning = true;
    const inspectInfo = (name: string, imageId: string, running: boolean, boundPort = port) => ({
      Id: `${name}-id`,
      Name: `/${name}`,
      Image: imageId,
      State: { Running: running },
      Config: {
        Labels: {
          'cloudcrane.service': 'production',
          'cloudcrane.website_id': websiteId,
          'cloudcrane.production_slug': productionSlug,
        },
        Image: imageTag,
        User: '1000:1000',
        WorkingDir: '/site',
      },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
        Binds: [`${runtimeRoot}:/site:ro`],
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        PidsLimit: 64,
      },
      NetworkSettings: {
        Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(boundPort) }] },
      },
    });
    const previousContainer = {
      inspect: vi.fn(async () => inspectInfo(previousName, previousImageId, previousRunning)),
      stop: vi.fn(async () => {
        previousRunning = false;
      }),
      start: vi.fn(async () => {
        previousRunning = true;
      }),
      rename: vi.fn(async ({ name }: { name: string }) => {
        containers.delete(previousName);
        previousName = name;
        containers.set(name, previousContainer);
      }),
      remove: vi.fn(async () => {
        containers.delete(previousName);
      }),
    };
    containers.set(previousName, previousContainer);
    const candidate = {
      inspect: vi.fn(async () =>
        inspectInfo(`cloudcrane-production-${websiteId}`, currentImageId, true, port + 1),
      ),
      exec: vi.fn(async () => ({
        start: vi.fn(async () => Readable.from([])),
        inspect: vi.fn(async () => ({ ExitCode: 0 })),
      })),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      remove: vi.fn(async () => {
        containers.delete(`cloudcrane-production-${websiteId}`);
      }),
    };
    const docker = {
      getContainer: vi.fn(
        (name: string) =>
          containers.get(name) ?? {
            inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
          },
      ),
      getImage: vi.fn(() => ({ inspect: vi.fn(async () => ({ Id: currentImageId })) })),
      createContainer: vi.fn(async () => {
        containers.set(`cloudcrane-production-${websiteId}`, candidate);
        return candidate as unknown as Docker.Container;
      }),
    } as unknown as Docker;
    const config = {
      runnerId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: path.join(base, 'workspaces'),
      productionRoot: path.join(base, 'production'),
      productionHostSuffix: 'sites.example.com',
      releaseArtifactRoot: path.join(base, 'releases'),
      productionKeepReleases: 5,
      productionImage: imageTag,
      workspaceImage: 'website-workspace-pboot:test',
      daemonPort: 7070,
      cpuLimit: 500_000_000,
      memoryLimitBytes: 268_435_456,
      pidsLimit: 64,
    };
    const provider = new DockerProductionProvider(
      config,
      docker,
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    try {
      await expect(provider.ensureRuntime(websiteId, productionSlug)).rejects.toMatchObject({
        code: 'PRODUCTION_HEALTHCHECK_FAILED',
      });
      expect(previousContainer.rename).toHaveBeenNthCalledWith(1, {
        name: `cloudcrane-production-previous-${websiteId}`,
      });
      expect(previousContainer.rename).toHaveBeenNthCalledWith(2, {
        name: `cloudcrane-production-${websiteId}`,
      });
      expect(previousContainer.start).toHaveBeenCalledOnce();
      expect(previousContainer.remove).not.toHaveBeenCalled();
      expect(candidate.stop).toHaveBeenCalledOnce();
      expect(candidate.remove).toHaveBeenCalledOnce();
      expect(previousRunning).toBe(true);
      expect(await readFile(path.join(runtimeRoot, '.production-port'), 'utf8')).toBe(`${port}\n`);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('restores a renamed previous container after Runner interruption without upgrading on startup', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-image-recovery-'));
    const websiteId = '00000000-0000-4000-8000-000000000001';
    const productionSlug = 'production-website';
    const runtimeRoot = path.join(base, 'production', websiteId);
    const canonicalName = `cloudcrane-production-${websiteId}`;
    const previousName = `cloudcrane-production-previous-${websiteId}`;
    const port = 43127;
    await mkdir(path.join(runtimeRoot, 'releases', releaseId), { recursive: true });
    await mkdir(path.join(runtimeRoot, 'shared'), { recursive: true });
    await symlink(path.join('releases', releaseId), path.join(runtimeRoot, 'current'), 'dir');
    await writeFile(path.join(runtimeRoot, 'shared', '.verified-release'), `${releaseId}\n`);
    await writeFile(path.join(runtimeRoot, '.production-port'), `${port}\n`);

    let name = previousName;
    let running = false;
    const info = () => ({
      Id: 'previous-container-id',
      Name: `/${name}`,
      Image: 'sha256:previous-image',
      State: { Running: running },
      Config: {
        Labels: {
          'cloudcrane.service': 'production',
          'cloudcrane.website_id': websiteId,
          'cloudcrane.production_slug': productionSlug,
        },
        Image: 'cloudcrane-production-pboot:test',
        User: '1000:1000',
        WorkingDir: '/site',
      },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
        Binds: ['/production:/site:ro'],
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        PidsLimit: 64,
      },
      NetworkSettings: {
        Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
      },
    });
    const previousContainer = {
      inspect: vi.fn(async () => info()),
      start: vi.fn(async () => {
        running = true;
      }),
      stop: vi.fn(async () => {
        running = false;
      }),
      rename: vi.fn(async ({ name: nextName }: { name: string }) => {
        containers.delete(name);
        name = nextName;
        containers.set(name, previousContainer);
      }),
      remove: vi.fn(async () => {
        containers.delete(name);
      }),
      update: vi.fn(
        async (options: { RestartPolicy?: { Name?: string } }) => options.RestartPolicy?.Name,
      ),
    };
    const containers = new Map<string, typeof previousContainer>([
      [previousName, previousContainer],
    ]);
    const containerFor = (containerName: string) => ({
      inspect: vi.fn(async () => {
        const container = containers.get(containerName);
        if (!container) throw { statusCode: 404 };
        return container.inspect();
      }),
      start: vi.fn(async () => {
        const container = containers.get(containerName);
        if (!container) throw { statusCode: 404 };
        return container.start();
      }),
      stop: vi.fn(async () => {
        const container = containers.get(containerName);
        if (!container) throw { statusCode: 404 };
        return container.stop?.();
      }),
      update: vi.fn(async (options: { RestartPolicy?: { Name?: string } }) => {
        const container = containers.get(containerName);
        if (!container) throw { statusCode: 404 };
        return container.update(options);
      }),
      rename: vi.fn(async (options: { name: string }) => {
        const container = containers.get(containerName);
        if (!container) throw { statusCode: 404 };
        return container.rename(options);
      }),
      remove: vi.fn(async () => {
        const container = containers.get(containerName);
        if (!container) throw { statusCode: 404 };
        return container.remove();
      }),
    });
    const docker = {
      listContainers: vi.fn(async () => [
        {
          Id: 'previous-container-id',
          Labels: info().Config.Labels,
        },
      ]),
      getContainer: vi.fn((containerName: string) => containerFor(containerName)),
      getImage: vi.fn(),
      createContainer: vi.fn(),
    } as unknown as Docker;
    const config = {
      runnerId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: path.join(base, 'workspaces'),
      productionRoot: path.join(base, 'production'),
      productionHostSuffix: 'sites.example.com',
      releaseArtifactRoot: path.join(base, 'releases'),
      productionKeepReleases: 5,
      productionImage: 'cloudcrane-production-pboot:test',
      workspaceImage: 'website-workspace-pboot:test',
      daemonPort: 7070,
      cpuLimit: 500_000_000,
      memoryLimitBytes: 268_435_456,
      pidsLimit: 64,
    };
    try {
      await expect(
        new DockerProductionProvider(
          config,
          docker,
          vi.fn(async () => new Response(null, { status: 204 })),
        ).reconcileRuntimes(),
      ).resolves.toEqual({ scanned: 1, restored: 0, failed: 0 });
      expect(name).toBe(canonicalName);
      expect(previousContainer.start).toHaveBeenCalledOnce();
      expect(docker.getImage).not.toHaveBeenCalled();
      expect(docker.createContainer).not.toHaveBeenCalled();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('reports a stopped runtime without executing inside the stopped container', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-stopped-'));
    const websiteId = '00000000-0000-4000-8000-000000000001';
    const runtimeDirectory = path.join(base, 'production', websiteId, 'shared', 'runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(path.join(runtimeDirectory, '.cloudcrane-authorization-v1'), 'authorized');
    const container = {
      id: 'container-id',
      inspect: vi.fn(async () => ({
        Id: 'container-id',
        State: { Running: false },
        Config: {
          Labels: {
            'cloudcrane.service': 'production',
            'cloudcrane.website_id': websiteId,
            'cloudcrane.production_slug': 'production-website',
          },
          Image: 'cloudcrane-production-pboot:test',
          User: '1000:1000',
          WorkingDir: '/site',
        },
        HostConfig: {
          PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }] },
          Binds: ['/production:/site:ro'],
          Privileged: false,
          ReadonlyRootfs: true,
          SecurityOpt: ['no-new-privileges:true'],
          CapDrop: ['ALL'],
          PidsLimit: 64,
        },
      })),
      exec: vi.fn(),
    };
    const docker = { getContainer: vi.fn(() => container) } as unknown as Docker;
    const config = {
      runnerId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: path.join(base, 'workspaces'),
      productionRoot: path.join(base, 'production'),
      releaseArtifactRoot: path.join(base, 'releases'),
      productionKeepReleases: 5,
      productionImage: 'cloudcrane-production-pboot:test',
      workspaceImage: 'cloudcrane-workspace-pboot:test',
      daemonPort: 7070,
      cpuLimit: 500_000_000,
      memoryLimitBytes: 268_435_456,
      pidsLimit: 64,
    };
    try {
      const result = await new DockerProductionProvider(config, docker).getStatus(
        websiteId,
        'production-website',
      );
      expect(result.status).toBe('stopped');
      expect(result.currentReleaseId).toBeNull();
      expect(result.authorized).toBe(true);
      expect(container.exec).not.toHaveBeenCalled();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('restores production containers with a current release and persistent restart policy', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-reconcile-'));
    const websiteId = '00000000-0000-4000-8000-000000000001';
    const releaseId = 'ded2a9d3-b4bd-4df9-9162-95b1a7b3ac53';
    const runtimeRoot = path.join(base, 'production', websiteId);
    await mkdir(path.join(runtimeRoot, 'releases'), { recursive: true });
    await mkdir(path.join(runtimeRoot, 'shared'), { recursive: true });
    await symlink(path.join('releases', releaseId), path.join(runtimeRoot, 'current'), 'dir');
    await writeFile(path.join(runtimeRoot, 'shared', '.verified-release'), `${releaseId}\n`);
    let running = false;
    let restartPolicy = 'no';
    const info = () => ({
      Id: 'container-id',
      State: { Running: running },
      Config: {
        Labels: {
          'cloudcrane.service': 'production',
          'cloudcrane.website_id': websiteId,
          'cloudcrane.production_slug': 'production-website',
        },
        Image: 'cloudcrane-production-pboot:test',
        User: '1000:1000',
        WorkingDir: '/site',
      },
      HostConfig: {
        RestartPolicy: { Name: restartPolicy },
        PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }] },
        Binds: ['/production:/site:ro'],
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        PidsLimit: 64,
      },
    });
    const container = {
      inspect: vi.fn(async () => info()),
      update: vi.fn(async (options: { RestartPolicy?: { Name?: string } }) => {
        restartPolicy = options.RestartPolicy?.Name ?? restartPolicy;
        return {};
      }),
      start: vi.fn(async () => {
        running = true;
      }),
    };
    const docker = {
      listContainers: vi.fn(async () => [{ Id: 'container-id', Labels: info().Config.Labels }]),
      getContainer: vi.fn(() => container),
    } as unknown as Docker;
    const config = {
      runnerId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: path.join(base, 'workspaces'),
      productionRoot: path.join(base, 'production'),
      releaseArtifactRoot: path.join(base, 'releases'),
      productionKeepReleases: 5,
      productionImage: 'cloudcrane-production-pboot:test',
      workspaceImage: 'cloudcrane-workspace-pboot:test',
      daemonPort: 7070,
      cpuLimit: 500_000_000,
      memoryLimitBytes: 268_435_456,
      pidsLimit: 64,
    };
    try {
      await expect(
        new DockerProductionProvider(config, docker).reconcileRuntimes(),
      ).resolves.toEqual({
        scanned: 1,
        restored: 1,
        failed: 0,
      });
      expect(container.update).toHaveBeenCalledWith({
        RestartPolicy: { Name: 'unless-stopped' },
      });
      expect(container.start).toHaveBeenCalledOnce();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('applies the official Pboot authorization helper and verifies the production Host', async () => {
    const authorizationCode = 'private-license-value';
    const info = {
      Id: 'container-id',
      State: { Running: true },
      Config: {
        Labels: {
          'cloudcrane.service': 'production',
          'cloudcrane.website_id': '00000000-0000-4000-8000-000000000001',
          'cloudcrane.production_slug': 'production-website',
        },
        Image: 'cloudcrane-production-pboot:test',
        User: '1000:1000',
        WorkingDir: '/site',
      },
      HostConfig: {
        PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }] },
        Binds: ['/production:/site:ro'],
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        PidsLimit: 64,
      },
      NetworkSettings: {
        Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '43127' }] },
      },
    };
    const command = {
      start: vi.fn(async () => Readable.from(['AUTHORIZED\n'])),
      inspect: vi.fn(async () => ({ ExitCode: 0 })),
    };
    const container = {
      inspect: vi.fn(async () => info),
      exec: vi.fn(async () => command),
    };
    const docker = {
      getContainer: vi.fn(() => container),
      modem: {
        demuxStream: vi.fn(
          (stream: Readable, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream) => {
            stream.pipe(stdout);
            stderr.end();
          },
        ),
      },
    } as unknown as Docker;
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-authorize-'));
    const config = {
      runnerId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: path.join(base, 'workspaces'),
      productionRoot: path.join(base, 'production'),
      productionHostSuffix: 'sites.example.com',
      releaseArtifactRoot: path.join(base, 'releases'),
      productionKeepReleases: 5,
      managedPbootBaseRoot: path.join(base, 'pboot-base'),
      productionImage: 'cloudcrane-production-pboot:test',
      workspaceImage: 'cloudcrane-workspace-pboot:test',
      daemonPort: 7070,
      cpuLimit: 500_000_000,
      memoryLimitBytes: 268_435_456,
      pidsLimit: 64,
    };
    const fetcher = vi.fn(async () => new Response('ok', { status: 200 }));
    try {
      const provider = new DockerProductionProvider(config, docker, fetcher);
      await provider.authorize(
        '00000000-0000-4000-8000-000000000001',
        'production-website',
        authorizationCode,
      );
      expect(container.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: ['cloudcrane-pboot-license'],
          Env: [`PBOOT_SN=${authorizationCode}`, 'PBOOT_SN_USER=', 'PBOOT_SITE_ROOT=/site/current'],
          User: '1000:1000',
          Tty: false,
        }),
      );
      expect(fetcher).toHaveBeenCalledWith(
        'http://127.0.0.1:43127/',
        expect.objectContaining({
          headers: expect.objectContaining({
            host: 'production-website.sites.example.com',
            'x-forwarded-host': 'production-website.sites.example.com',
            'x-forwarded-proto': 'https',
          }),
        }),
      );
      expect(JSON.stringify(fetcher.mock.calls)).not.toContain(authorizationCode);

      vi.mocked(command.inspect).mockResolvedValueOnce({ ExitCode: 22 });
      const authorizationFailure = await provider
        .authorize('00000000-0000-4000-8000-000000000001', 'production-website', authorizationCode)
        .catch((error: unknown) => error);
      const failureMessage =
        authorizationFailure instanceof Error ? authorizationFailure.message : '';
      expect(failureMessage).toBe('PBOOT_AUTHORIZATION_UPDATE_FAILED:EXIT_22');
      expect(failureMessage).not.toContain(authorizationCode);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
