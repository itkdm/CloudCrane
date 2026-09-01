import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';
import { WorkspaceDaemonClient } from './infrastructure/daemon/workspace-daemon-client.js';

const enabled = process.env.CLOUDCRANE_DOCKER_INTEGRATION === '1';
const referenceFile = (workspaceId: string) =>
  `/workspace/.cloudcrane/references/template-source/template/demo/${workspaceId}.html`;

async function initialize(client: WorkspaceDaemonClient, executionId: string): Promise<void> {
  await expect(
    client.exec({
      command: 'cloudcrane-init-pboot',
      args: [],
      cwd: '/workspace',
      env: {},
      timeoutMs: 120_000,
      maxOutputBytes: 8_192,
      executionId,
    }),
  ).resolves.toMatchObject({ exitCode: 0 });
}

describe.skipIf(!enabled)('read-only Pboot template reference', () => {
  it('isolates two references and keeps each target workspace writable', async () => {
    const workspaceA = '00000000-0000-4000-8000-000000000031';
    const workspaceB = '00000000-0000-4000-8000-000000000032';
    const referenceRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-reference-'));
    const workspaceRoot = path.join(referenceRoot, 'workspaces');
    for (const [workspaceId, marker] of [
      [workspaceA, 'REFERENCE_A'],
      [workspaceB, 'REFERENCE_B'],
    ] as const) {
      const reference = path.join(referenceRoot, workspaceId);
      await mkdir(path.join(reference, 'template/demo'), { recursive: true });
      await mkdir(path.join(reference, 'skin/css'), { recursive: true });
      await writeFile(
        path.join(reference, `template/demo/${workspaceId}.html`),
        `<h1>${marker}</h1>`,
      );
      await writeFile(path.join(reference, 'skin/css/site.css'), 'body{}');
    }
    const docker = new Docker();
    const provider = new DockerWorkspaceProvider(
      { ...loadRunnerConfig(), referenceRoot, workspaceRoot },
      docker,
    );
    const runtimes: string[] = [];
    try {
      const runtimeA = await provider.create(workspaceA);
      runtimes.push(workspaceA);
      const runtimeB = await provider.create(workspaceB);
      runtimes.push(workspaceB);
      const containerA = await docker.getContainer(runtimeA.containerRef!).inspect();
      expect(containerA.HostConfig?.Binds).toContain(
        `${path.join(referenceRoot, workspaceA)}:/workspace/.cloudcrane/references/template-source:ro`,
      );
      const clientA = new WorkspaceDaemonClient(runtimeA.endpoint!, 10_000);
      const clientB = new WorkspaceDaemonClient(runtimeB.endpoint!, 10_000);
      await initialize(clientA, '00000000-0000-4000-8000-000000000034');
      await initialize(clientB, '00000000-0000-4000-8000-000000000035');
      for (const [client, workspaceId, marker, executionId] of [
        [clientA, workspaceA, 'REFERENCE_A', '00000000-0000-4000-8000-000000000036'],
        [clientB, workspaceB, 'REFERENCE_B', '00000000-0000-4000-8000-000000000037'],
      ] as const) {
        await expect(client.read({ path: referenceFile(workspaceId) })).resolves.toMatchObject({
          content: `<h1>${marker}</h1>`,
        });
        await expect(
          client.list({ path: '/workspace/.cloudcrane/references/template-source/template/demo' }),
        ).resolves.toMatchObject({ entries: [expect.objectContaining({ type: 'file' })] });
        await expect(
          client.exec({
            command: 'sh',
            args: [
              '-c',
              `find /workspace/.cloudcrane/references/template-source -type f && rg ${marker} /workspace/.cloudcrane/references/template-source`,
            ],
            cwd: '/workspace',
            env: {},
            timeoutMs: 10_000,
            maxOutputBytes: 8_192,
            executionId,
          }),
        ).resolves.toMatchObject({ exitCode: 0, stdout: expect.stringContaining(marker) });
        await expect(
          client.write({ path: `${referenceFile(workspaceId)}.blocked`, content: 'blocked' }),
        ).rejects.toBeDefined();
      }
      await expect(clientA.read({ path: referenceFile(workspaceB) })).rejects.toBeDefined();
      const editResult = await clientA.exec({
        command: 'sed',
        args: ['-i', 's/REFERENCE_A/EDITED/', referenceFile(workspaceA)],
        cwd: '/workspace',
        env: {},
        timeoutMs: 10_000,
        maxOutputBytes: 8_192,
        executionId: '00000000-0000-4000-8000-000000000038',
      });
      expect(editResult.exitCode).not.toBe(0);
      const deleteResult = await clientA.exec({
        command: 'rm',
        args: [referenceFile(workspaceA)],
        cwd: '/workspace',
        env: {},
        timeoutMs: 10_000,
        maxOutputBytes: 8_192,
        executionId: '00000000-0000-4000-8000-000000000039',
      });
      expect(deleteResult.exitCode).not.toBe(0);
      await expect(
        clientA.write({ path: '/workspace/reference-target.txt', content: 'target' }),
      ).resolves.toBeDefined();
      await expect(
        clientA.exec({
          command: 'rm',
          args: ['/workspace/reference-target.txt'],
          cwd: '/workspace',
          env: {},
          timeoutMs: 10_000,
          maxOutputBytes: 8_192,
          executionId: '00000000-0000-4000-8000-000000000042',
        }),
      ).resolves.toMatchObject({ exitCode: 0 });
      const tracked = await clientA.exec({
        command: 'git',
        args: ['ls-files', '.cloudcrane/references'],
        cwd: '/workspace',
        env: {},
        timeoutMs: 10_000,
        maxOutputBytes: 8_192,
        executionId: '00000000-0000-4000-8000-000000000040',
      });
      expect(tracked).toMatchObject({ exitCode: 0, stdout: '' });
      const status = await clientA.exec({
        command: 'git',
        args: ['status', '--porcelain'],
        cwd: '/workspace',
        env: {},
        timeoutMs: 10_000,
        maxOutputBytes: 8_192,
        executionId: '00000000-0000-4000-8000-000000000041',
      });
      expect(status).toMatchObject({ exitCode: 0, stdout: '' });
    } finally {
      for (const workspaceId of runtimes)
        await provider.destroyRuntime(workspaceId).catch(() => undefined);
      await rm(referenceRoot, { recursive: true, force: true });
    }
  }, 360_000);
});
