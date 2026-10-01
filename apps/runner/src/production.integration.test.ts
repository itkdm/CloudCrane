import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { buildProductionReleaseArchive } from '@cloudcrane/pboot-snapshot';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';
import { WorkspaceRuntimeService } from './application/workspace-runtime-service.js';
import { ProductionReleaseStager } from './application/production-release-stager.js';
import { WorkspaceDaemonClient } from './infrastructure/daemon/workspace-daemon-client.js';
import {
  DockerProductionProvider,
  switchCurrentRelease,
} from './infrastructure/docker/docker-production-provider.js';
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

  it('publishes the pinned PbootCMS base into the real Production image', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-real-pboot-production-'));
    const workspaceId = '00000000-0000-4000-8000-000000000078';
    const realWebsiteId = '00000000-0000-4000-8000-000000000079';
    const managedBase = path.join(base, 'managed-pboot');
    const config = loadRunnerConfig({
      WORKSPACE_ROOT: path.join(base, 'workspaces'),
      WORKSPACE_IMAGE: 'website-workspace-pboot:v1',
      WORKSPACE_MANAGED_PBOOT_BASE_ROOT: managedBase,
      RELEASE_ARTIFACT_ROOT: path.join(base, 'artifacts'),
      PRODUCTION_ROOT: path.join(base, 'production'),
      PRODUCTION_IMAGE: 'cloudcrane-production-pboot:v1',
      PRODUCTION_HOST_SUFFIX: 'sites.example.com',
      WORKSPACE_CPU_LIMIT: '500000000',
      WORKSPACE_MEMORY_LIMIT_BYTES: '268435456',
      WORKSPACE_PIDS_LIMIT: '64',
    });
    const workspaceProvider = new DockerWorkspaceProvider(config);
    const workspaceRuntime = new WorkspaceRuntimeService(workspaceProvider);
    const docker = new Docker();
    const provider = new DockerProductionProvider(config, docker);
    let workspaceCreated = false;
    let productionCreated = false;
    let productionContainerRef: string | null = null;

    try {
      await workspaceProvider.create(workspaceId);
      workspaceCreated = true;
      const daemon = new WorkspaceDaemonClient(await workspaceProvider.getEndpoint(workspaceId));
      const initialized = await daemon.exec({
        command: 'cloudcrane-init-pboot',
        args: [],
        cwd: '/workspace',
        env: {},
        timeoutMs: 90_000,
        maxOutputBytes: 16_384,
        executionId: '00000000-0000-4000-8000-000000000080',
      });
      expect(initialized.exitCode).toBe(0);
      expect(initialized.stdout).toContain('INITIALIZED');

      const workspaceRoot = path.join(config.workspaceRoot, workspaceId, 'workspace');
      await cp(workspaceRoot, managedBase, { recursive: true, errorOnExist: true });
      await writeFile(
        path.join(managedBase, '.cloudcrane-base'),
        `pbootcms=3.2.26\nsourceCommit=${coreCommit}\n`,
      );
      const stager = new ProductionReleaseStager(workspaceRuntime, config);
      const releaseId = '00000000-0000-4000-8000-000000000081';
      const staged = await stager.stage(realWebsiteId, workspaceId, {
        artifactStorageKey: `release-${releaseId}.zip`,
        releaseId,
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: coreCommit,
        firstPublish: true,
      });

      const runtime = await provider.ensureRuntime(realWebsiteId, 'real-pboot-integration');
      productionCreated = true;
      productionContainerRef = runtime.containerRef;
      const published = await provider.deployRelease({
        websiteId: realWebsiteId,
        releaseId,
        productionSlug: 'real-pboot-integration',
        artifactStorageKey: staged.artifactStorageKey,
        artifactSha256: staged.artifactSha256,
        artifactSize: staged.artifactSize,
        firstPublish: true,
      });
      expect(published.currentReleaseId).toBe(releaseId);
      expect(published.status).toBe('authorization_required');

      const container = docker.getContainer(productionContainerRef!);
      const probe = await container.exec({
        Cmd: [
          'php',
          '-r',
          '$c=require "/site/current/config/database.php"; if (!extension_loaded("SQLite3")) exit(11); $p="/site/current".$c["database"]["dbname"]; $d=new SQLite3($p); if (!$d->querySingle("SELECT count(*) FROM sqlite_master")) exit(12);',
        ],
        User: '1000:1000',
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const probeStream = await probe.start({ hijack: true, stdin: false });
      await new Promise<void>((resolve, reject) => {
        probeStream.once('end', resolve);
        probeStream.once('close', resolve);
        probeStream.once('error', reject);
        probeStream.resume();
      });
      expect((await probe.inspect()).ExitCode).toBe(0);

      const origin = `http://127.0.0.1:${published.productionPort}`;
      const health = await fetch(`${origin}/_cloudcrane/health`);
      expect(health.status).toBe(204);
      const home = await fetch(`${origin}/`);
      const homeBody = await home.text();
      const errorInfo = /font-size:20px[^>]*>([\s\S]*?)<span id="time"/i
        .exec(homeBody)?.[1]
        ?.replace(/<[^>]*>/g, ' ')
        .replace(/&(?:nbsp|amp|lt|gt|quot);/g, ' ')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      expect(home.status).toBe(403);
      expect(errorInfo).toContain('未匹配到本域名');
      const admin = await fetch(`${origin}/admin.php`, { redirect: 'manual' });
      expect(admin.status).toBe(200);
      const adminCss = await fetch(
        `${origin}/apps/admin/view/default/layui/css/layui.css?v=2.13.9`,
      );
      expect(adminCss.status).toBe(200);
      const captcha = await fetch(`${origin}/core/code.php`, { redirect: 'manual' });
      expect(captcha.status).toBe(200);
      expect((await fetch(`${origin}/data/cloudcrane.db`)).status).toBe(403);
      expect((await fetch(`${origin}/static/backup/`)).status).toBe(403);
      expect((await fetch(`${origin}/apps/admin/controller/IndexController.php`)).status).toBe(403);
      expect((await fetch(`${origin}/core/database/Sqlite.php`)).status).toBe(403);
      expect((await fetch(`${origin}/cloudcrane-rewrite-probe`)).status).toBeLessThan(500);

      const markerSql = await container.exec({
        Cmd: [
          'php',
          '-r',
          '$c=require "/site/current/config/database.php"; $d=new SQLite3("/site/current".$c["database"]["dbname"]); $d->exec("CREATE TABLE IF NOT EXISTS cloudcrane_e2e_marker (value TEXT)"); $d->exec("INSERT INTO cloudcrane_e2e_marker(value) VALUES (\'preserve-production-content\')");',
        ],
        User: '1000:1000',
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const markerStream = await markerSql.start({ hijack: true, stdin: false });
      await new Promise<void>((resolve, reject) => {
        markerStream.once('end', resolve);
        markerStream.once('close', resolve);
        markerStream.once('error', reject);
        markerStream.resume();
      });
      expect((await markerSql.inspect()).ExitCode).toBe(0);

      await daemon.write({
        path: '/workspace/template/default/cloudcrane-release-note.txt',
        content: 'second release',
      });
      const secondReleaseId = '00000000-0000-4000-8000-000000000082';
      const secondArtifact = await stager.stage(realWebsiteId, workspaceId, {
        artifactStorageKey: `release-${secondReleaseId}.zip`,
        releaseId: secondReleaseId,
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: coreCommit,
        firstPublish: false,
      });
      const secondPublished = await provider.deployRelease({
        websiteId: realWebsiteId,
        releaseId: secondReleaseId,
        productionSlug: 'real-pboot-integration',
        artifactStorageKey: secondArtifact.artifactStorageKey,
        artifactSha256: secondArtifact.artifactSha256,
        artifactSize: secondArtifact.artifactSize,
        firstPublish: false,
      });
      expect(secondPublished.currentReleaseId).toBe(secondReleaseId);
      const productionContent = await container.exec({
        Cmd: [
          'php',
          '-r',
          '$c=require "/site/current/config/database.php"; $d=new SQLite3("/site/current".$c["database"]["dbname"]); if ($d->querySingle("SELECT value FROM cloudcrane_e2e_marker LIMIT 1") !== "preserve-production-content") exit(13);',
        ],
        User: '1000:1000',
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const contentStream = await productionContent.start({ hijack: true, stdin: false });
      await new Promise<void>((resolve, reject) => {
        contentStream.once('end', resolve);
        contentStream.once('close', resolve);
        contentStream.once('error', reject);
        contentStream.resume();
      });
      expect((await productionContent.inspect()).ExitCode).toBe(0);
    } catch (error) {
      if (productionContainerRef) {
        const logs = await docker
          .getContainer(productionContainerRef)
          .logs({ stdout: true, stderr: true, tail: 40 })
          .catch(() => Buffer.from('unable to retrieve production container logs'));
        const details = Buffer.isBuffer(logs) ? logs.toString('utf8') : String(logs);
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${details}`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      if (productionCreated)
        await provider.destroyRuntime(realWebsiteId, []).catch(() => undefined);
      if (workspaceCreated)
        await workspaceProvider.destroyRuntime(workspaceId).catch(() => undefined);
      await rm(base, { recursive: true, force: true });
    }
  }, 300_000);

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
        "<?php return ['database' => [\n  'type' => 'sqlite',\n  'dbname' => '/data/pbootcms.db',\n]];\n",
      );
      await writeFile(
        path.join(workspace, 'config', 'database.php'),
        "<?php return ['database' => [\n  'type' => 'sqlite',\n  'dbname' => '/data/pbootcms.db',\n]];\n",
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
      await mkdir(path.join(productionRoot, websiteId, 'shared', 'runtime', 'config'), {
        recursive: true,
      });
      await writeFile(
        path.join(productionRoot, websiteId, 'shared', 'runtime', 'config', 'failed-first-publish'),
        'must be discarded',
      );
      await expect(deployRelease(firstReleaseId, true, firstArtifact)).rejects.toMatchObject({
        code: 'PRODUCTION_HEALTHCHECK_FAILED',
      });
      await expect(
        lstat(path.join(productionRoot, websiteId, 'shared', 'data', 'cloudcrane.db')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        lstat(
          path.join(
            productionRoot,
            websiteId,
            'shared',
            'runtime',
            'config',
            'failed-first-publish',
          ),
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      failInitialHealthCheck = false;
      await provider.ensureRuntime(websiteId, productionSlug);
      const first = await deployRelease(firstReleaseId, true, firstArtifact);
      expect(first).toMatchObject({
        status: 'authorization_required',
        currentReleaseId: firstReleaseId,
      });
      expect(
        await readFile(path.join(productionRoot, websiteId, 'shared', '.verified-release'), 'utf8'),
      ).toBe(`${firstReleaseId}\n`);
      await expect(
        lstat(path.join(productionRoot, websiteId, 'shared', '.initializing-release')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await writeFile(
        path.join(productionRoot, websiteId, 'shared', '.initializing-release'),
        `${firstReleaseId}\n`,
      );
      await provider.getStatus(websiteId, productionSlug);
      await expect(
        lstat(path.join(productionRoot, websiteId, 'shared', '.initializing-release')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
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

      const runtimeRoot = path.join(productionRoot, websiteId, 'shared', 'runtime');
      const cacheFixture = await docker.getContainer(first.containerRef!).exec({
        Cmd: [
          '/bin/sh',
          '-c',
          'mkdir -p /site/shared/runtime/cache /site/shared/runtime/complile /site/shared/runtime/session /site/shared/runtime/image && printf "release one" > /site/shared/runtime/cache/cached-page.html && printf "release one" > /site/shared/runtime/complile/compiled-template.php && printf "session must survive" > /site/shared/runtime/session/session.data && printf "image must survive" > /site/shared/runtime/image/generated.jpg',
        ],
        User: '1000:1000',
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const cacheFixtureStream = await cacheFixture.start({ hijack: true, stdin: false });
      await new Promise<void>((resolve, reject) => {
        cacheFixtureStream.once('end', resolve);
        cacheFixtureStream.once('close', resolve);
        cacheFixtureStream.once('error', reject);
        cacheFixtureStream.resume();
      });
      expect((await cacheFixture.inspect()).ExitCode).toBe(0);

      await writeFile(
        path.join(workspace, 'template', 'default', 'integration.php'),
        "<?php $db = new PDO('sqlite:/site/shared/data/cloudcrane.db'); echo file_get_contents('/site/shared/data/runtime-marker.txt') . '|release-two|' . $db->query('SELECT value FROM sample')->fetchColumn() . '|' . file_get_contents('/site/shared/data/initial-marker.txt') . '|' . file_get_contents('/site/shared/upload/logo.txt');\n",
      );
      await replaceWorkspaceDatabaseFixture(docker, config.productionImage, workspace);
      await writeFile(
        path.join(workspace, 'static', 'upload', 'logo.txt'),
        'changed-workspace-upload',
      );
      const second = await writeRelease(secondReleaseId, false);
      expect(second.currentReleaseId).toBe(secondReleaseId);
      expect(
        await readFile(path.join(productionRoot, websiteId, 'shared', '.verified-release'), 'utf8'),
      ).toBe(`${secondReleaseId}\n`);
      for (const directory of ['cache', 'complile'])
        await expect(lstat(path.join(runtimeRoot, directory))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      expect(await readFile(path.join(runtimeRoot, 'session', 'session.data'), 'utf8')).toBe(
        'session must survive',
      );
      expect(await readFile(path.join(runtimeRoot, 'image', 'generated.jpg'), 'utf8')).toBe(
        'image must survive',
      );
      const secondResponse = await fetch(
        `http://127.0.0.1:${second.productionPort}/template/default/integration.php`,
      );
      expect(secondResponse.status).toBe(200);
      expect(await secondResponse.text()).toBe(
        'production-owned|release-two|initial-production-db|initial-production-state|initial-production-upload',
      );
      expect(second.status).toBe('active');

      const interruptedReleaseId = '00000000-0000-4000-8000-000000000077';
      const interruptedDirectory = path.join(
        productionRoot,
        websiteId,
        'releases',
        interruptedReleaseId,
      );
      await mkdir(path.join(interruptedDirectory, 'template', 'default'), { recursive: true });
      await writeFile(path.join(interruptedDirectory, 'index.php'), "<?php echo 'interrupted';\n");
      await symlink(
        path.join(productionRoot, websiteId, 'shared', 'data'),
        path.join(interruptedDirectory, 'data'),
        'dir',
      );
      await symlink(
        path.join(productionRoot, websiteId, 'shared', 'upload'),
        path.join(interruptedDirectory, 'static'),
        'dir',
      );
      await switchCurrentRelease(productionRoot, interruptedReleaseId);
      const recoveringProvider = new DockerProductionProvider(
        config,
        docker,
        async (request, init) => {
          const candidate = await readlink(path.join(productionRoot, websiteId, 'current'));
          if (candidate.endsWith(interruptedReleaseId))
            return new Response('unhealthy', { status: 503 });
          return fetch(request, init);
        },
      );
      const recovered = await recoveringProvider.getStatus(websiteId, productionSlug);
      expect(recovered.currentReleaseId).toBe(secondReleaseId);
      expect(await readlink(path.join(productionRoot, websiteId, 'current'))).toBe(
        path.join('releases', secondReleaseId),
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
