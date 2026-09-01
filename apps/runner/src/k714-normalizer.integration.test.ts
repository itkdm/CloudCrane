import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';
import { WorkspaceDaemonClient } from './infrastructure/daemon/workspace-daemon-client.js';

const enabled = process.env.CLOUDCRANE_DOCKER_INTEGRATION === '1';

async function waitForHealth(client: WorkspaceDaemonClient): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await client.health();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Workspace daemon did not become ready');
}

describe.skipIf(!enabled)('K714 normalizer integration', () => {
  it('runs the synthetic fixture through the Workspace process path', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000021';
    const provider = new DockerWorkspaceProvider(loadRunnerConfig(), new Docker());
    let created = false;
    try {
      await provider.create(workspaceId);
      created = true;
      const client = new WorkspaceDaemonClient(await provider.getEndpoint(workspaceId), 10_000);
      await waitForHealth(client);
      await expect(
        client.exec({
          command: 'cloudcrane-init-pboot',
          args: [],
          cwd: '/workspace',
          env: {},
          timeoutMs: 120_000,
          maxOutputBytes: 8_192,
          executionId: '00000000-0000-4000-8000-000000000022',
        }),
      ).resolves.toMatchObject({ exitCode: 0 });
      await expect(
        client.exec({
          command: 'sh',
          args: ['/app/docker/workspace-pboot/normalizer-fixtures.sh'],
          cwd: '/workspace',
          env: {},
          timeoutMs: 120_000,
          maxOutputBytes: 16_384,
          executionId: '00000000-0000-4000-8000-000000000023',
        }),
      ).resolves.toMatchObject({ exitCode: 0, stdout: 'K714_FIXTURES_PASS\n' });
    } finally {
      if (created) await provider.destroyRuntime(workspaceId).catch(() => undefined);
    }
  }, 180_000);
});
