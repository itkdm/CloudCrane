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
      expect(info.preview).toMatchObject({ status: 'ready', port: 8080 });
      const bootstrap = await client.exec({
        command: 'cloudcrane-init-pboot',
        args: [],
        cwd: '/workspace',
        env: {},
        timeoutMs: 120_000,
        maxOutputBytes: 8_192,
        executionId: '00000000-0000-4000-8000-000000000006',
      });
      expect(bootstrap).toMatchObject({ exitCode: 0, stdout: 'INITIALIZED\n' });
      for (const path of [
        '/workspace/index.php',
        '/workspace/admin.php',
        '/workspace/data/pbootcms.db',
        '/workspace/AGENTS.md',
      ])
        await expect(client.stat({ path })).resolves.toMatchObject({ path });
      for (const path of [
        '/workspace/apps',
        '/workspace/core',
        '/workspace/config',
        '/workspace/template',
        '/workspace/static',
      ])
        await expect(client.stat({ path })).resolves.toMatchObject({ path, type: 'directory' });
      expect((await client.stat({ path: '/workspace/.git' })).type).toBe('directory');
      const marker = await client.read({ path: '/workspace/.cloudcrane/bootstrap.json' });
      expect(marker.content).toContain('29ff72ee5afc9c6553b949f04d3fc99443879f40');
      expect(
        (
          await client.exec({
            command: 'sqlite3',
            args: ['/workspace/data/pbootcms.db', 'PRAGMA integrity_check;'],
            cwd: '/workspace',
            env: {},
            timeoutMs: 5_000,
            maxOutputBytes: 1_000,
            executionId: '00000000-0000-4000-8000-000000000007',
          })
        ).stdout.trim(),
      ).toBe('ok');
      await expect(
        client.exec({
          command: 'php',
          args: [
            '-r',
            '$db = new PDO("sqlite:/workspace/data/pbootcms.db"); exit($db->query("PRAGMA integrity_check")->fetchColumn() === "ok" ? 0 : 1);',
          ],
          cwd: '/workspace',
          env: {},
          timeoutMs: 5_000,
          maxOutputBytes: 1_000,
          executionId: '00000000-0000-4000-8000-000000000009',
        }),
      ).resolves.toMatchObject({ exitCode: 0 });
      await expect(
        client.exec({
          command: 'curl',
          args: ['-fsS', 'http://127.0.0.1:8080/'],
          cwd: '/workspace',
          env: {},
          timeoutMs: 10_000,
          maxOutputBytes: 100_000,
          executionId: '00000000-0000-4000-8000-00000000000a',
        }),
      ).resolves.toMatchObject({ exitCode: 0 });
      await expect(
        client.exec({
          command: 'curl',
          args: ['-fsS', 'http://127.0.0.1:8080/admin.php'],
          cwd: '/workspace',
          env: {},
          timeoutMs: 10_000,
          maxOutputBytes: 100_000,
          executionId: '00000000-0000-4000-8000-00000000000b',
        }),
      ).resolves.toMatchObject({ exitCode: 0 });
      await expect(
        client.exec({
          command: 'git',
          args: ['-C', '/workspace', 'status', '--porcelain'],
          cwd: '/workspace',
          env: {},
          timeoutMs: 5_000,
          maxOutputBytes: 1_000,
          executionId: '00000000-0000-4000-8000-00000000000c',
        }),
      ).resolves.toMatchObject({ exitCode: 0, stdout: '' });
      await expect(
        client.exec({
          command: 'cloudcrane-init-pboot',
          args: [],
          cwd: '/workspace',
          env: {},
          timeoutMs: 5_000,
          maxOutputBytes: 1_000,
          executionId: '00000000-0000-4000-8000-000000000008',
        }),
      ).resolves.toMatchObject({ exitCode: 0, stdout: 'ALREADY_INITIALIZED\n' });
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
      expect(inspected.NetworkSettings?.Ports?.['7070/tcp']?.[0]?.HostPort).toBeTruthy();
      expect(inspected.NetworkSettings?.Ports?.['8080/tcp']?.[0]?.HostPort).toBeTruthy();
      const stopped = await provider.stop(workspaceId);
      expect(stopped.status).toBe('stopped');
      const restarted = await provider.start(workspaceId);
      expect(restarted.status).toBe('running');
      expect(restarted.previewPort).toBeGreaterThan(0);
      const restartedClient = new WorkspaceDaemonClient(
        await provider.getEndpoint(workspaceId),
        5_000,
      );
      await expect(restartedClient.runtimeInfo()).resolves.toMatchObject({
        preview: { status: 'ready', port: 8080 },
      });
      await provider.destroyRuntime(workspaceId);
      created = false;
      const recreated = await provider.create(workspaceId);
      created = true;
      const recreatedClient = new WorkspaceDaemonClient(
        await provider.getEndpoint(workspaceId),
        5_000,
      );
      await waitForHealth(recreatedClient);
      expect((await recreatedClient.read({ path: '/workspace/persistence.txt' })).content).toBe(
        'updated',
      );
      expect(recreated.containerRef).toBeTruthy();
    } finally {
      if (created) await provider.destroyRuntime(workspaceId).catch(() => undefined);
    }
  }, 120_000);
});
