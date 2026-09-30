import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { buildProductionReleaseArchive } from '@cloudcrane/pboot-snapshot';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';
import { DockerProductionProvider } from './infrastructure/docker/docker-production-provider.js';

const enabled = process.env.CLOUDCRANE_DOCKER_INTEGRATION === '1';
const websiteId = '00000000-0000-4000-8000-000000000071';
const productionSlug = 'production-integration-site';
const coreCommit = '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea';

describe.skipIf(!enabled)('Docker Production Runtime integration', () => {
  it('atomically switches immutable code and preserves initialized production state', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-production-integration-'));
    const workspace = path.join(base, 'workspace');
    const managedBase = path.join(base, 'managed-pboot');
    const artifacts = path.join(base, 'artifacts');
    const productionRoot = path.join(base, 'production');
    const docker = new Docker();
    const config = loadRunnerConfig({
      PRODUCTION_ROOT: productionRoot,
      PRODUCTION_IMAGE: 'cloudcrane-production-pboot:v1',
      RELEASE_ARTIFACT_ROOT: artifacts,
      WORKSPACE_MANAGED_PBOOT_BASE_ROOT: managedBase,
      WORKSPACE_CPU_LIMIT: '500000000',
      WORKSPACE_MEMORY_LIMIT_BYTES: '268435456',
      WORKSPACE_PIDS_LIMIT: '64',
    });
    const provider = new DockerProductionProvider(config, docker);
    const firstReleaseId = '00000000-0000-4000-8000-000000000072';
    const secondReleaseId = '00000000-0000-4000-8000-000000000073';
    let runtimeCreated = false;
    let runtimeContainerRef: string | undefined;

    const writeRelease = async (releaseId: string, firstPublish: boolean) => {
      const archivePath = path.join(artifacts, `release-${releaseId}.zip`);
      const result = await buildProductionReleaseArchive({
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
      return provider.deployRelease({
        websiteId,
        releaseId,
        productionSlug,
        artifactStorageKey: `release-${releaseId}.zip`,
        artifactSha256: result.sha256,
        artifactSize: result.size,
        firstPublish,
      });
    };

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
      await writeFile(path.join(workspace, 'data', 'pbootcms.db'), 'initial-workspace-db');
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
      const first = await writeRelease(firstReleaseId, true);
      expect(first).toMatchObject({
        status: 'authorization_required',
        currentReleaseId: firstReleaseId,
      });
      const firstResponse = await fetch(
        `http://127.0.0.1:${first.productionPort}/template/default/integration.php`,
      );
      expect(firstResponse.status).toBe(200);
      expect(await firstResponse.text()).toBe('production-owned|release-one');

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
        "<?php echo file_get_contents('/site/shared/data/runtime-marker.txt') . '|release-two|' . file_get_contents('/site/shared/data/pbootcms.db') . '|' . file_get_contents('/site/shared/data/initial-marker.txt') . '|' . file_get_contents('/site/shared/upload/logo.txt');\n",
      );
      await writeFile(path.join(workspace, 'data', 'pbootcms.db'), 'changed-workspace-db');
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
        'production-owned|release-two|initial-workspace-db|initial-production-state|initial-production-upload',
      );

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
      if (runtimeCreated) await provider.destroyRuntime(websiteId).catch(() => undefined);
      await rm(base, { recursive: true, force: true });
    }
  }, 180_000);
});
