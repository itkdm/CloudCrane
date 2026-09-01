import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';
import { WorkspaceDaemonClient } from './infrastructure/daemon/workspace-daemon-client.js';

const enabled = process.env.CLOUDCRANE_DOCKER_INTEGRATION === '1';

describe.skipIf(!enabled)('read-only Pboot template reference', () => {
  it('mounts a synthetic reference read-only while keeping the target writable', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000031';
    const referenceRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-reference-'));
    const reference = path.join(referenceRoot, workspaceId);
    await mkdir(path.join(reference, 'template/demo'), { recursive: true });
    await mkdir(path.join(reference, 'skin/css'), { recursive: true });
    await writeFile(path.join(reference, 'template/demo/index.html'), '<h1>reference</h1>');
    await writeFile(path.join(reference, 'skin/css/site.css'), 'body{}');
    const provider = new DockerWorkspaceProvider(
      {
        ...loadRunnerConfig(),
        referenceRoot,
        workspaceRoot: path.join(referenceRoot, 'workspaces'),
      },
      new Docker(),
    );
    let created = false;
    try {
      const runtime = await provider.create(workspaceId);
      created = true;
      const client = new WorkspaceDaemonClient(runtime.endpoint!, 10_000);
      await expect(
        client.exec({
          command: 'cloudcrane-init-pboot',
          args: [],
          cwd: '/workspace',
          env: {},
          timeoutMs: 120_000,
          maxOutputBytes: 8_192,
          executionId: '00000000-0000-4000-8000-000000000034',
        }),
      ).resolves.toMatchObject({ exitCode: 0 });
      await expect(
        client.read({ path: '/workspace/.agents/skills/pboot-template-migration/SKILL.md' }),
      ).resolves.toMatchObject({ content: expect.stringContaining('REFERENCE') });
      await expect(
        client.read({
          path: '/workspace/.cloudcrane/references/template-source/template/demo/index.html',
        }),
      ).resolves.toMatchObject({
        content: '<h1>reference</h1>',
      });
      await expect(
        client.list({ path: '/workspace/.cloudcrane/references/template-source/template/demo' }),
      ).resolves.toMatchObject({
        entries: [expect.objectContaining({ type: 'file' })],
      });
      await expect(
        client.write({
          path: '/workspace/.cloudcrane/references/template-source/template/demo/blocked.html',
          content: 'must fail',
        }),
      ).rejects.toBeDefined();
      await expect(
        client.exec({
          command: 'sh',
          args: [
            '-c',
            'find /workspace/.cloudcrane/references/template-source -type f && rg reference /workspace/.cloudcrane/references/template-source',
          ],
          cwd: '/workspace',
          env: {},
          timeoutMs: 10_000,
          maxOutputBytes: 8_192,
          executionId: '00000000-0000-4000-8000-000000000032',
        }),
      ).resolves.toMatchObject({ exitCode: 0 });
      await expect(
        client.write({ path: '/workspace/reference-target.txt', content: 'target' }),
      ).resolves.toBeDefined();
      const deleteResult = await client.exec({
        command: 'rm',
        args: ['/workspace/.cloudcrane/references/template-source/template/demo/index.html'],
        cwd: '/workspace',
        env: {},
        timeoutMs: 10_000,
        maxOutputBytes: 8_192,
        executionId: '00000000-0000-4000-8000-000000000033',
      });
      expect(deleteResult.exitCode).not.toBe(0);
    } finally {
      if (created) await provider.destroyRuntime(workspaceId).catch(() => undefined);
      await rm(referenceRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
