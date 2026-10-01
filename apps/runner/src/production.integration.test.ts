import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { buildProductionReleaseArchive } from '@cloudcrane/pboot-snapshot';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';
import { WorkspaceRuntimeService } from './application/workspace-runtime-service.js';
import { ProductionReleaseStager } from './application/production-release-stager.js';
import { WorkspaceDaemonClient } from './infrastructure/daemon/workspace-daemon-client.js';
import { DockerProductionProvider } from './infrastructure/docker/docker-production-provider.js';
import { DockerWorkspaceProvider } from './infrastructure/docker/docker-workspace-provider.js';

const enabled = process.env.CLOUDCRANE_DOCKER_INTEGRATION === '1';
const websiteId = '00000000-0000-4000-8000-000000000071';
const productionSlug = 'production-integration-site';
const coreCommit = '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea';

describe.skipIf(!enabled)('Docker Production Runtime integration', () => {
  it('stages a first release from a verified SQLite online backup in Workspace', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-stage-'));
    const workspaceId = '00000000-0000-4000-8000-000000000074';
    const managedBase = path.join(base, 'managed-pboot');
    const config = loadRunnerConfig({
      WORKSPACE_ROOT: path.join(base, 'workspaces'),
      WORKSPACE_IMAGE: 'website-workspace-pboot:v1',
      WORKSPACE_MANAGED_PBOOT_BASE_ROOT: managedBase,
      RELEASE_ARTIFACT_ROOT: path.join(base, 'artifacts'),
      PRODUCTION_ROOT: path.join(base, 'production'),
      PRODUCTION_IMAGE: 'cloudcrane-production-pboot:v1',
      WORKSPACE_CPU_LIMIT: '500000000',
      WORKSPACE_MEMORY_LIMIT_BYTES: '268435456',
      WORKSPACE_PIDS_LIMIT: '64',
    });
    const workspaceProvider = new DockerWorkspaceProvider(config);
    const runtime = new WorkspaceRuntimeService(workspaceProvider);
    let runtimeCreated = false;

    try {
      await mkdir(path.join(managedBase, 'apps'), { recursive: true });
      await writeFile(
        path.join(managedBase, '.cloudcrane-base'),
        `pbootcms=3.2.26\nsourceCommit=${coreCommit}\n`,
      );
      await writeFile(path.join(managedBase, 'apps', 'core.php'), '<?php // trusted core\n');

      const created = await workspaceProvider.create(workspaceId);
      runtimeCreated = true;
      expect(created.workspacePath).toBeTruthy();
      const daemon = new WorkspaceDaemonClient(await workspaceProvider.getEndpoint(workspaceId));
      for (const directory of ['apps', 'config', 'data', 'static/upload'])
        await daemon.mkdir({ path: `/workspace/${directory}`, recursive: true });
      await daemon.write({ path: '/workspace/apps/core.php', content: '<?php // trusted core\n' });
      await daemon.write({ path: '/workspace/config/config.php', content: '<?php return [];\n' });
      await daemon.exec({
        command: 'sqlite3',
        args: [
          '/workspace/data/pbootcms.db',
          "CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES('snapshot');",
        ],
        cwd: '/workspace',
        env: {},
        timeoutMs: 10_000,
        maxOutputBytes: 16_384,
        executionId: '00000000-0000-4000-8000-000000000075',
      });

      const stager = new ProductionReleaseStager(runtime, config);
      const releaseId = '00000000-0000-4000-8000-000000000076';
      const staged = await stager.stage(websiteId, workspaceId, {
        artifactStorageKey: `release-${releaseId}.zip`,
        releaseId,
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: coreCommit,
        firstPublish: true,
      });

      expect(staged.artifactSize).toBeGreaterThan(0);
      expect(staged.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(staged.manifest).toMatchObject({
        sourceWebsiteId: websiteId,
        firstPublish: true,
        sourceGitHead: null,
        sourceGitDirty: true,
      });
    } finally {
      if (runtimeCreated)
        await workspaceProvider.destroyRuntime(workspaceId).catch(() => undefined);
      await rm(base, { recursive: true, force: true });
    }
  }, 180_000);

  it('atomically switches immutable code and preserves initialized production state', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-integration-'));
    const workspace = path.join(base, 'workspace');
    const managedBase = path.join(base, 'managed-pboot');
    const artifacts = path.join(base, 'artifacts');
    const productionRoot = path.join(base, 'production');
    const docker = new Docker();
    const config = loadRunnerConfig({
      PRODUCTION_ROOT: productionRoot,
      PRODUCTION_HOST_SUFFIX: 'sites.example.com',
      PRODUCTION_IMAGE: 'cloudcrane-production-pboot:v1',
      RELEASE_ARTIFACT_ROOT: artifacts,
      WORKSPACE_MANAGED_PBOOT_BASE_ROOT: managedBase,
      WORKSPACE_CPU_LIMIT: '500000000',
      WORKSPACE_MEMORY_LIMIT_BYTES: '268435456',
      WORKSPACE_PIDS_LIMIT: '64',
    });
    let failInitialHealthCheck = true;
    const fetcher: typeof fetch = async (input, init) => {
      if (failInitialHealthCheck) return new Response('unavailable', { status: 503 });
      return fetch(input, init);
    };
    const provider = new DockerProductionProvider(config, docker, fetcher);
    const firstReleaseId = '00000000-0000-4000-8000-000000000072';
    const secondReleaseId = '00000000-0000-4000-8000-000000000073';
    let runtimeCreated = false;
    let runtimeContainerRef: string | undefined;

    const buildRelease = async (releaseId: string, firstPublish: boolean) => {
      const archivePath = path.join(artifacts, `release-${releaseId}.zip`);
      return buildProductionReleaseArchive({
        workspaceRoot: workspace,
        managedBaseRoot: managedBase,
        sourceWebsiteId: websiteId,
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: coreCommit,
        sourceGitHead: null,
        sourceGitDirty: true,
        firstPublish,
        releaseId,
        outputPath: archivePath,
      });
    };
    const deployRelease = async (
      releaseId: string,
      firstPublish: boolean,
      artifact: Awaited<ReturnType<typeof buildProductionReleaseArchive>>,
    ) =>
      provider.deployRelease({
        websiteId,
        releaseId,
        productionSlug,
        artifactStorageKey: `release-${releaseId}.zip`,
        artifactSha256: artifact.sha256,
        artifactSize: artifact.size,
        firstPublish,
      });
    const writeRelease = async (releaseId: string, firstPublish: boolean) =>
      deployRelease(releaseId, firstPublish, await buildRelease(releaseId, firstPublish));

    try {
      for (const directory of [
        path.join(workspace, 'apps'),
        path.join(workspace, 'config'),
        path.join(workspace, 'data'),
        path.join(workspace, 'static', 'upload'),
        path.join(managedBase, 'apps'),
        path.join(managedBase, 'config'),
        path.join(managedBase, 'template', 'default'),
      ])
        await mkdir(directory, { recursive: true });

      await initializeProductionTestDatabase(
        docker,
        config.productionImage,
        path.join(workspace, 'data'),
      );

      await writeFile(
        path.join(managedBase, '.cloudcrane-base'),
        `pbootcms=3.2.26\nsourceCommit=${coreCommit}\n`,
      );
      await writeFile(path.join(managedBase, 'apps', 'core.php'), '<?php // trusted core\n');
      await writeFile(path.join(workspace, 'apps', 'core.php'), '<?php // trusted core\n');
      await writeFile(
        path.join(managedBase, 'index.php'),
        '<?php require __DIR__ . "/template/default/index.php";\n',
      );
      await writeFile(
        path.join(workspace, 'index.php'),
        '<?php require __DIR__ . "/template/default/index.php";\n',
      );
      await writeFile(
        path.join(managedBase, 'config', 'database.php'),
        "<?php return ['type' => 'sqlite', 'dbname' => '/data/pbootcms.db'];\n",
      );
      await writeFile(
        path.join(workspace, 'config', 'database.php'),
        "<?php return ['type' => 'sqlite', 'dbname' => '/data/pbootcms.db'];\n",
      );
      await writeFile(path.join(workspace, 'config', 'config.php'), '<?php return [];\n');
      await writeFile(
        path.join(workspace, 'data', 'initial-marker.txt'),
        'initial-production-state',
      );
      await writeFile(
        path.join(workspace, 'static', 'upload', 'logo.txt'),
        'initial-production-upload',
      );
      await mkdir(path.join(workspace, 'template', 'default'), { recursive: true });
      await writeFile(
        path.join(workspace, 'template', 'default', 'index.php'),
        "<?php echo 'pboot-home';\n",
      );
      await writeFile(
        path.join(workspace, 'template', 'default', 'integration.php'),
        "<?php file_put_contents('/site/shared/data/runtime-marker.txt', 'production-owned', LOCK_EX); echo file_get_contents('/site/shared/data/runtime-marker.txt') . '|release-one';\n",
      );

      const runtime = await provider.ensureRuntime(websiteId, productionSlug);
      runtimeCreated = true;
      runtimeContainerRef = runtime.containerRef ?? undefined;
      const firstArtifact = await buildRelease(firstReleaseId, true);
      await expect(deployRelease(firstReleaseId, true, firstArtifact)).rejects.toMatchObject({
        code: 'PRODUCTION_HEALTHCHECK_FAILED',
      });
      await expect(
        lstat(path.join(productionRoot, websiteId, 'shared', 'data', 'pbootcms.db')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      failInitialHealthCheck = false;
      await provider.ensureRuntime(websiteId, productionSlug);
      const first = await deployRelease(firstReleaseId, true, firstArtifact);
      expect(first).toMatchObject({
        status: 'authorization_required',
        currentReleaseId: firstReleaseId,
      });
      const firstResponse = await fetch(
        `http://127.0.0.1:${first.productionPort}/template/default/integration.php`,
      );
      expect(firstResponse.status).toBe(200);
      expect(await firstResponse.text()).toBe('production-owned|release-one');
      await provider.authorize(websiteId, productionSlug, 'fixture-authorization-code');
      expect(await provider.getStatus(websiteId, productionSlug)).toMatchObject({
        status: 'active',
        currentReleaseId: firstReleaseId,
      });

      const inspected = await docker.getContainer(first.containerRef!).inspect();
      expect(inspected.Config?.User).toBe('1000:1000');
      expect(inspected.Config?.WorkingDir).toBe('/site');
      expect(inspected.HostConfig?.Privileged).toBe(false);
      expect(inspected.HostConfig?.ReadonlyRootfs).toBe(true);
      expect(inspected.HostConfig?.CapDrop).toContain('ALL');
      expect(inspected.HostConfig?.Binds?.some((bind) => bind.includes('docker.sock'))).toBe(false);
      expect(inspected.HostConfig?.PortBindings?.['8080/tcp']?.[0]?.HostIp).toBe('127.0.0.1');
      expect(
        (await fetch(`http://127.0.0.1:${first.productionPort}/data/pbootcms.db`)).status,
      ).toBe(403);
      expect(
        (await fetch(`http://127.0.0.1:${first.productionPort}/config/database.php`)).status,
      ).toBe(403);

      await writeFile(
        path.join(workspace, 'template', 'default', 'integration.php'),
        "<?php $db = new PDO('sqlite:/site/shared/data/pbootcms.db'); echo file_get_contents('/site/shared/data/runtime-marker.txt') . '|release-two|' . $db->query('SELECT value FROM sample')->fetchColumn() . '|' . file_get_contents('/site/shared/data/initial-marker.txt') . '|' . file_get_contents('/site/shared/upload/logo.txt');\n",
      );
      await replaceWorkspaceDatabaseFixture(docker, config.productionImage, workspace);
      await writeFile(
        path.join(workspace, 'static', 'upload', 'logo.txt'),
        'changed-workspace-upload',
      );
      const second = await writeRelease(secondReleaseId, false);
      expect(second.currentReleaseId).toBe(secondReleaseId);
      const secondResponse = await fetch(
        `http://127.0.0.1:${second.productionPort}/template/default/integration.php`,
      );
      expect(secondResponse.status).toBe(200);
      expect(await secondResponse.text()).toBe(
        'production-owned|release-two|initial-production-db|initial-production-state|initial-production-upload',
      );
      expect(second.status).toBe('active');

      expect(await readlink(path.join(productionRoot, websiteId, 'current'))).toBe(
        path.join('releases', secondReleaseId),
      );
      expect(
        await readFile(
          path.join(
            productionRoot,
            websiteId,
            'releases',
            firstReleaseId,
            'template',
            'default',
            'integration.php',
          ),
          'utf8',
        ),
      ).toContain('release-one');
      expect(
        await readFile(
          path.join(
            productionRoot,
            websiteId,
            'releases',
            secondReleaseId,
            'template',
            'default',
            'integration.php',
          ),
          'utf8',
        ),
      ).toContain('release-two');
    } catch (error) {
      if (runtimeContainerRef) {
        const logs = await docker
          .getContainer(runtimeContainerRef)
          .logs({ stdout: true, stderr: true, tail: 40 })
          .catch(() => Buffer.from('unable to retrieve production container logs'));
        const details = Buffer.isBuffer(logs) ? logs.toString('utf8') : String(logs);
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${details}`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      if (runtimeCreated) await provider.destroyRuntime(websiteId, []).catch(() => undefined);
      await rm(base, { recursive: true, force: true });
    }
  }, 180_000);
});

async function initializeProductionTestDatabase(
  docker: Docker,
  image: string,
  dataDirectory: string,
): Promise<void> {
  await chmod(dataDirectory, 0o777);
  const initializer = await docker.createContainer({
    Image: image,
    Entrypoint: ['php'],
    Cmd: [
      '-r',
      '$db = new PDO("sqlite:/seed/pbootcms.db"); $db->exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES (\'initial-production-db\'); CREATE TABLE ay_config (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, value TEXT, type TEXT, sorting INTEGER, description TEXT);");',
    ],
    User: '1000:1000',
    HostConfig: {
      Binds: [`${dataDirectory}:/seed:rw`],
      NetworkMode: 'none',
      Privileged: false,
      ReadonlyRootfs: true,
      SecurityOpt: ['no-new-privileges:true'],
      CapDrop: ['ALL'],
      AutoRemove: false,
    },
  });
  try {
    await initializer.start();
    const result = await initializer.wait();
    if (result.StatusCode !== 0) throw new Error('test SQLite database initialization failed');
  } finally {
    await initializer.remove({ force: true }).catch(() => undefined);
    await chmod(dataDirectory, 0o755);
  }
}

async function replaceWorkspaceDatabaseFixture(
  docker: Docker,
  image: string,
  workspaceDirectory: string,
): Promise<void> {
  const updater = await docker.createContainer({
    Image: image,
    Entrypoint: ['php'],
    Cmd: ['-r', "file_put_contents('/workspace/data/pbootcms.db', 'changed-workspace-db');"],
    User: '1000:1000',
    HostConfig: {
      Binds: [`${workspaceDirectory}:/workspace:rw`],
      NetworkMode: 'none',
      Privileged: false,
      ReadonlyRootfs: true,
      SecurityOpt: ['no-new-privileges:true'],
      CapDrop: ['ALL'],
      AutoRemove: false,
    },
  });
  try {
    await updater.start();
    const result = await updater.wait();
    if (result.StatusCode !== 0) throw new Error('test Workspace database update failed');
  } finally {
    await updater.remove({ force: true }).catch(() => undefined);
  }
}
