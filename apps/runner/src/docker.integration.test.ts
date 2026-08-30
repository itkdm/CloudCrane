import Docker, { type ContainerInspectInfo } from 'dockerode';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';
import { WorkspaceDaemonClient } from './infrastructure/daemon/workspace-daemon-client.js';

const enabled = process.env.CLOUDCRANE_DOCKER_INTEGRATION === '1';

describe.skipIf(!enabled)('Docker Workspace Runtime integration', () => {
  it('runs the daemon and preserves Workspace state across runtime recreation', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const config = loadRunnerConfig();
    const docker = new Docker();
    const provider = new DockerWorkspaceProvider(config, docker);
    let created = false;
    try {
      const runtime = await provider.create(workspaceId);
      created = true;
      const endpoint = await provider.getEndpoint(workspaceId);
      expect(new URL(endpoint).hostname).toBe('127.0.0.1');
      const client = new WorkspaceDaemonClient(endpoint, 5_000);
      expect((await client.health()).status).toBe('ok');
      const info = await client.runtimeInfo();
      expect(info.uid).not.toBe(0);
      await client.write({
        path: '/workspace/persistence.txt',
        content: 'survives runtime recreation',
      });
      expect((await client.read({ path: '/workspace/persistence.txt' })).content).toBe(
        'survives runtime recreation',
      );
      const result = await client.exec({
        command: 'sh',
        args: ['-c', 'printf runtime-ok'],
        cwd: '/workspace',
        env: {},
        timeoutMs: 5_000,
        maxOutputBytes: 1_000,
        executionId: '00000000-0000-4000-8000-000000000002',
      });
      expect(result).toMatchObject({
        stdout: 'runtime-ok',
        exitCode: 0,
        status: 'completed',
        truncated: false,
      });
      const inspected = (await docker
        .getContainer(runtime.containerRef!)
        .inspect()) as ContainerInspectInfo;
      expect(inspected.HostConfig?.Privileged).toBe(false);
      expect(inspected.HostConfig?.NetworkMode).toContain('cloudcrane-workspace-');
      expect(inspected.HostConfig?.PidMode ?? '').toBe('');
      expect(inspected.HostConfig?.IpcMode ?? '').toBe('');
      expect(
        inspected.HostConfig?.Binds?.some((mount) => mount.includes('/var/run/docker.sock')),
      ).toBe(false);
      expect(inspected.HostConfig?.Memory).toBeGreaterThan(0);
      expect(inspected.HostConfig?.PidsLimit).toBeGreaterThan(0);
      await provider.destroyRuntime(workspaceId);
      created = false;
      const recreated = await provider.create(workspaceId);
      created = true;
      const recreatedClient = new WorkspaceDaemonClient(
        await provider.getEndpoint(workspaceId),
        5_000,
      );
      expect((await recreatedClient.read({ path: '/workspace/persistence.txt' })).content).toBe(
        'survives runtime recreation',
      );
      expect(recreated.containerRef).toBeTruthy();
    } finally {
      if (created) await provider.destroyRuntime(workspaceId).catch(() => undefined);
    }
  }, 120_000);
});
