import Docker, { type ContainerInspectInfo } from 'dockerode';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';
import { WorkspaceDaemonClient } from './infrastructure/daemon/workspace-daemon-client.js';

const enabled = process.env.CLOUDCRANE_DOCKER_INTEGRATION === '1';

async function waitForHealth(client: WorkspaceDaemonClient): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      expect((await client.health()).status).toBe('ok');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error('Workspace daemon did not become ready');
}

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
      await waitForHealth(client);
      const info = await client.runtimeInfo();
      expect(info.uid).not.toBe(0);
      await client.write({
        path: '/workspace/persistence.txt',
        content: 'survives runtime recreation',
      });
      expect((await client.read({ path: '/workspace/persistence.txt' })).content).toBe(
        'survives runtime recreation',
      );
      const firstSha = (await client.read({ path: '/workspace/persistence.txt' })).sha256;
      await client.write({
        path: '/workspace/persistence.txt',
        content: 'updated',
        expectedSha256: firstSha,
      });
      await expect(
        client.write({
          path: '/workspace/persistence.txt',
          content: 'conflict',
          expectedSha256: firstSha,
        }),
      ).rejects.toMatchObject({ code: 'FILE_CHANGED' });
      await expect(client.read({ path: '/workspace/../etc/passwd' })).rejects.toMatchObject({
        code: 'PATH_OUT_OF_SCOPE',
      });
      await expect(
        client.exec({
          command: 'sh',
          args: ['-c', 'sleep 2'],
          cwd: '/workspace',
          env: {},
          timeoutMs: 50,
          maxOutputBytes: 1_000,
          executionId: '00000000-0000-4000-8000-000000000003',
        }),
      ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
      const cancelId = '00000000-0000-4000-8000-000000000004';
      const cancellable = client.exec({
        command: 'sh',
        args: ['-c', 'sleep 10'],
        cwd: '/workspace',
        env: {},
        timeoutMs: 20_000,
        maxOutputBytes: 1_000,
        executionId: cancelId,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await client.cancel(cancelId)).cancelled).toBe(true);
      await expect(cancellable).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
      const outbound = await client.exec({
        command: 'curl',
        args: ['-fsSI', '--max-time', '10', 'https://deb.debian.org'],
        cwd: '/workspace',
        env: {},
        timeoutMs: 20_000,
        maxOutputBytes: 100_000,
        executionId: '00000000-0000-4000-8000-000000000005',
      });
      expect(outbound.exitCode).toBe(0);
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
      expect(inspected.HostConfig?.PidMode).toBe('');
      expect(inspected.HostConfig?.IpcMode).toBe('private');
      expect(
        inspected.HostConfig?.Binds?.some((mount) => mount.includes('/var/run/docker.sock')),
      ).toBe(false);
      expect(inspected.HostConfig?.Memory).toBeGreaterThan(0);
      expect(inspected.HostConfig?.PidsLimit).toBeGreaterThan(0);
      expect(inspected.HostConfig?.SecurityOpt).toContain('no-new-privileges:true');
      const networkInfo = await docker
        .getNetwork(inspected.HostConfig?.NetworkMode ?? '')
        .inspect();
      expect(networkInfo.Name).toBe(`cloudcrane-workspace-${workspaceId}`);
      expect(networkInfo.Internal).toBe(false);
      expect(Object.keys(inspected.NetworkSettings?.Networks ?? {})).toHaveLength(1);
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
