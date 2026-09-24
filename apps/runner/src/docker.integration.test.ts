import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  it('preserves Workspace state across restart and removes it when the runtime is destroyed', async () => {
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
        '/workspace/.agents/skills/pboot-template-migration/SKILL.md',
        '/workspace/.agents/skills/pbootcms-upgrade/SKILL.md',
        '/workspace/.agents/skills/template-publish/SKILL.md',
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
      expect(marker.content).toContain('8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea');
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
      expect((await restartedClient.read({ path: '/workspace/persistence.txt' })).content).toBe(
        'updated',
      );
      await provider.destroyRuntime(workspaceId);
      created = false;
      const recreated = await provider.create(workspaceId);
      created = true;
      const recreatedClient = new WorkspaceDaemonClient(
        await provider.getEndpoint(workspaceId),
        5_000,
      );
      await waitForHealth(recreatedClient);
      await expect(
        recreatedClient.read({ path: '/workspace/persistence.txt' }),
      ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
      expect(recreated.containerRef).toBeTruthy();
    } finally {
      if (created) await provider.destroyRuntime(workspaceId).catch(() => undefined);
    }
  }, 120_000);

  it('reconciles a legacy runtime without a reference bind and preserves Workspace files', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000043';
    const config = loadRunnerConfig();
    const docker = new Docker();
    const provider = new DockerWorkspaceProvider(config, docker);
    const persistentPath = path.join(config.workspaceRoot, workspaceId, 'workspace');
    let runtimeCreated = false;
    try {
      await provider.create(workspaceId);
      runtimeCreated = true;
      await provider.destroyRuntime(workspaceId);
      runtimeCreated = false;
      await mkdir(persistentPath, { recursive: true });
      await writeFile(path.join(persistentPath, 'reconcile-preserves.txt'), 'preserved');
      const network = await docker.createNetwork({
        Name: `cloudcrane-workspace-${workspaceId}`,
        Driver: 'bridge',
        Internal: false,
      });
      const legacy = await docker.createContainer({
        Image: config.workspaceImage,
        name: `cloudcrane-workspace-${workspaceId}`,
        User: '1000:1000',
        WorkingDir: '/workspace',
        Env: [
          `WORKSPACE_ID=${workspaceId}`,
          'WORKSPACE_DAEMON_PORT=7070',
          'WORKSPACE_DAEMON_HOST=0.0.0.0',
        ],
        ExposedPorts: { '7070/tcp': {}, '8080/tcp': {} },
        HostConfig: {
          Binds: [`${persistentPath}:/workspace`],
          NetworkMode: network.id,
          PortBindings: {
            '7070/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }],
            '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }],
          },
          Privileged: false,
          PidMode: '',
          IpcMode: 'private',
          SecurityOpt: ['no-new-privileges:true'],
          NanoCpus: config.cpuLimit,
          Memory: config.memoryLimitBytes,
          PidsLimit: config.pidsLimit,
          AutoRemove: false,
        },
      });
      await legacy.start();
      runtimeCreated = true;
      const legacyId = legacy.id;
      const reconciled = await provider.getStatus(workspaceId);
      expect(reconciled.containerRef).toBeTruthy();
      expect(reconciled.containerRef).not.toBe(legacyId);
      const inspected = await docker.getContainer(reconciled.containerRef!).inspect();
      expect(inspected.HostConfig?.Binds).toContain(
        `${path.join(config.referenceRoot!, workspaceId)}:/workspace/.cloudcrane/references:ro`,
      );
      expect(
        await new WorkspaceDaemonClient(await provider.getEndpoint(workspaceId), 10_000).read({
          path: '/workspace/reconcile-preserves.txt',
        }),
      ).toMatchObject({ content: 'preserved' });
    } finally {
      if (runtimeCreated) await provider.destroyRuntime(workspaceId).catch(() => undefined);
    }
  }, 180_000);
});
