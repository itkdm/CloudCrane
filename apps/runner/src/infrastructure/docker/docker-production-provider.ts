import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PassThrough, type Readable } from 'node:stream';
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import Docker from 'dockerode';
import { extractProductionReleaseArchive } from '@cloudcrane/pboot-snapshot';
import { createLogger } from '@cloudcrane/shared';
import type { RunnerConfig } from '../../config.js';
import type {
  ProductionContentSnapshot,
  ProductionDeployInput,
  ProductionProvider,
  ProductionRuntime,
} from '../../ports/production-provider.js';
import { ProductionOperationError } from '../../ports/production-operation-error.js';

type CurrentLinkOperations = Pick<typeof import('node:fs/promises'), 'symlink' | 'rename'>;
const logger = createLogger('runner-production-provider');

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('could not allocate a loopback port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export async function switchCurrentRelease(
  productionRoot: string,
  releaseId: string,
  operations: CurrentLinkOperations = { symlink, rename },
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(releaseId))
    throw new Error('invalid release id for current symlink');
  const root = path.resolve(productionRoot);
  const target = path.join(root, 'releases', releaseId);
  const current = path.join(root, 'current');
  const temporary = path.join(root, `.current-${releaseId}-${process.pid}-${Date.now()}`);
  await operations.symlink(path.relative(root, target), temporary, 'dir');
  try {
    await operations.rename(temporary, current);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class DockerProductionProvider implements ProductionProvider {
  constructor(
    private readonly config: RunnerConfig,
    private readonly docker = new Docker(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly portAllocator: () => Promise<number> = allocateLoopbackPort,
  ) {}

  async reconcileRuntimes(): Promise<{ scanned: number; restored: number; failed: number }> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: ['cloudcrane.service=production'] }),
    });
    let restored = 0;
    let failed = 0;
    for (const item of containers) {
      const labels = item.Labels ?? {};
      const websiteId = labels['cloudcrane.website_id'];
      const productionSlug = labels['cloudcrane.production_slug'];
      if (!websiteId || !productionSlug) continue;
      const container = this.docker.getContainer(item.Id);
      try {
        let info = await container.inspect();
        this.assertRuntimeMatches(info, websiteId, productionSlug);
        if (info.HostConfig?.RestartPolicy?.Name !== 'unless-stopped') {
          await container.update({ RestartPolicy: { Name: 'unless-stopped' } });
          info = await container.inspect();
        }
        const release = await this.optionalCurrentRelease(this.root(websiteId));
        if (!info.State?.Running && release) {
          await container.start();
          restored += 1;
        }
        if (release) await this.reconcileActivation(websiteId, productionSlug);
      } catch (error) {
        failed += 1;
        logger.warn(
          {
            event: 'production.runtime.reconcile.failed',
            websiteId,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          },
          'production runtime reconciliation failed',
        );
      }
    }
    return { scanned: containers.length, restored, failed };
  }

  async ensureRuntime(websiteId: string, productionSlug: string): Promise<ProductionRuntime> {
    this.assertId(websiteId);
    this.assertSlug(productionSlug);
    const root = this.root(websiteId);
    await this.ensureLayout(root);
    const slugPath = path.join(root, '.production-slug');
    if (await this.exists(slugPath)) {
      if ((await readFile(slugPath, 'utf8')) !== productionSlug)
        throw new ProductionOperationError(
          'PRODUCTION_STATE_CONFLICT',
          'Production slug does not match the existing runtime',
        );
    } else {
      await writeFileSecure(slugPath, productionSlug);
    }
    const containerName = this.containerName(websiteId);
    const persistedPort = await this.readProductionPort(root);
    const container = this.docker.getContainer(containerName);
    let info: Docker.ContainerInspectInfo | undefined;
    try {
      info = await container.inspect();
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
    if (!info) {
      const networkName = this.networkName(websiteId);
      const portToBind = persistedPort ?? (await this.portAllocator());
      let network: Docker.Network | undefined;
      try {
        network = await this.docker.createNetwork({
          Name: networkName,
          Driver: 'bridge',
          Internal: false,
          Labels: { 'cloudcrane.service': 'production', 'cloudcrane.website_id': websiteId },
        });
        const created = await this.docker.createContainer({
          Image: this.config.productionImage,
          name: containerName,
          User: '1000:1000',
          WorkingDir: '/site',
          ExposedPorts: { '8080/tcp': {} },
          Labels: {
            'cloudcrane.service': 'production',
            'cloudcrane.website_id': websiteId,
            'cloudcrane.production_slug': productionSlug,
          },
          HostConfig: {
            Binds: [
              `${root}:/site:ro`,
              `${path.join(root, 'shared', 'data')}:/site/shared/data:rw`,
              `${path.join(root, 'shared', 'upload')}:/site/shared/upload:rw`,
              `${path.join(root, 'shared', 'config')}:/site/shared/config:rw`,
              `${path.join(root, 'shared', 'runtime')}:/site/shared/runtime:rw`,
            ],
            NetworkMode: networkName,
            PortBindings: {
              '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(portToBind) }],
            },
            Privileged: false,
            ReadonlyRootfs: true,
            SecurityOpt: ['no-new-privileges:true'],
            CapDrop: ['ALL'],
            PidMode: '',
            IpcMode: 'private',
            NanoCpus: this.config.cpuLimit,
            Memory: this.config.memoryLimitBytes,
            PidsLimit: this.config.pidsLimit,
            Tmpfs: {
              '/tmp': 'rw,noexec,nosuid,size=64m',
              '/run': 'rw,noexec,nosuid,size=8m',
              '/var/cache/nginx': 'rw,noexec,nosuid,size=16m',
            },
            AutoRemove: false,
            RestartPolicy: { Name: 'unless-stopped' },
            LogConfig: {
              Type: 'json-file',
              Config: { 'max-size': '10m', 'max-file': '5' },
            },
          },
        });
        try {
          await created.start();
          info = await created.inspect();
          const assignedPort = this.runtimePort(info);
          if (!assignedPort || assignedPort !== portToBind)
            throw new Error('Production container did not retain its reserved loopback port');
          await this.persistProductionPort(root, assignedPort);
        } catch (error) {
          await created.remove({ force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        await network?.remove().catch(() => undefined);
        throw error;
      }
    } else {
      this.assertRuntimeMatches(info, websiteId, productionSlug);
      if (info.HostConfig?.RestartPolicy?.Name !== 'unless-stopped') {
        await container.update({ RestartPolicy: { Name: 'unless-stopped' } });
        info = await container.inspect();
      }
      if (info.State?.Running !== true) {
        await container.start();
        info = await container.inspect();
      }
      const assignedPort = this.runtimePort(info);
      if (assignedPort) await this.persistProductionPort(root, assignedPort);
    }
    await this.reconcileActivation(websiteId, productionSlug);
    return this.runtime(
      websiteId,
      productionSlug,
      info.Id ?? container.id,
      info,
      await this.readVerifiedRelease(root),
      await this.isAuthorizationComplete(websiteId),
    );
  }

  async deployRelease(input: ProductionDeployInput): Promise<ProductionRuntime> {
    this.assertId(input.websiteId);
    this.assertId(input.releaseId);
    this.assertSlug(input.productionSlug);
    const root = this.root(input.websiteId);
    await this.ensureLayout(root);
    await this.reconcileActivation(input.websiteId, input.productionSlug);
    const currentRelease = await this.optionalCurrentRelease(root);
    const previousVerifiedRelease = await this.readVerifiedRelease(root);
    if (currentRelease !== previousVerifiedRelease)
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'Production activation is still being reconciled',
      );
    if (currentRelease === input.releaseId) {
      const runtime = await this.inspectRuntime(input.websiteId, input.productionSlug);
      if (!(await this.waitForHealth(runtime.productionPort, input.productionSlug)))
        throw new ProductionOperationError(
          'PRODUCTION_HEALTHCHECK_FAILED',
          'The requested production release is current but did not pass its health check',
        );
      if (input.firstPublish) await this.completeInitialPersistentState(root, input.releaseId);
      await this.writeVerifiedRelease(root, input.releaseId);
      if (input.firstPublish) await this.finalizeInitialPersistentState(root, input.releaseId);
      return {
        ...runtime,
        currentReleaseId: input.releaseId,
        status: runtime.authorized ? 'active' : 'authorization_required',
      };
    }
    const archive = this.artifactPath(input.artifactStorageKey);
    const archiveInfo = await lstat(archive);
    if (
      !archiveInfo.isFile() ||
      archiveInfo.isSymbolicLink() ||
      archiveInfo.size !== input.artifactSize
    )
      throw new Error('production release artifact size does not match metadata');
    const releaseDirectory = path.join(root, 'releases', input.releaseId);
    const stagingDirectory = path.join(
      root,
      'releases',
      `.staging-${input.releaseId}-${Date.now()}`,
    );
    const previousRelease = previousVerifiedRelease;
    if (input.firstPublish && previousRelease)
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'First publish cannot replace an active release',
      );
    if (!input.firstPublish && !previousRelease)
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'Production runtime has no current release',
      );
    if (await this.exists(releaseDirectory))
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'The requested release directory already exists',
      );

    const manifest = await extractProductionReleaseArchive({
      archivePath: archive,
      expectedSha256: input.artifactSha256,
      expectedWebsiteId: input.websiteId,
      expectedReleaseId: input.releaseId,
      destination: stagingDirectory,
    });
    let switched = false;
    try {
      if (manifest.firstPublish !== input.firstPublish)
        throw new Error('production release first-publish flag does not match request');
      await this.initializePersistentState(
        root,
        stagingDirectory,
        manifest,
        input.firstPublish,
        input.releaseId,
      );
      await this.installSharedLinks(root, stagingDirectory, releaseDirectory);
      await rename(stagingDirectory, releaseDirectory);
      await this.makeReleaseReadOnly(releaseDirectory);
      await switchCurrentRelease(root, input.releaseId);
      switched = true;
      const runtime = await this.inspectRuntime(input.websiteId, input.productionSlug);
      if (!(await this.waitForHealth(runtime.productionPort, input.productionSlug)))
        throw new ProductionOperationError(
          'PRODUCTION_HEALTHCHECK_FAILED',
          'Production runtime health check failed',
        );
      const authorized = await this.isAuthorizationComplete(input.websiteId);
      if (input.firstPublish) await this.completeInitialPersistentState(root, input.releaseId);
      await this.refreshPbootReleaseState(input.websiteId, root);
      if (!(await this.waitForHealth(runtime.productionPort, input.productionSlug)))
        throw new ProductionOperationError(
          'PRODUCTION_HEALTHCHECK_FAILED',
          'Production runtime health check failed after release refresh',
        );
      await this.writeVerifiedRelease(root, input.releaseId);
      if (input.firstPublish) await this.finalizeInitialPersistentState(root, input.releaseId);
      await this.collectOldReleases(input.websiteId, input.releaseId, previousRelease).catch(
        (error: unknown) => {
          logger.warn(
            {
              event: 'production.release.gc.failed',
              websiteId: input.websiteId,
              releaseId: input.releaseId,
              errorType: error instanceof Error ? error.constructor.name : typeof error,
            },
            'production release cleanup failed',
          );
        },
      );
      return {
        ...runtime,
        currentReleaseId: input.releaseId,
        status: authorized ? 'active' : 'authorization_required',
      };
    } catch (error) {
      if (switched) {
        if (previousRelease) await switchCurrentRelease(root, previousRelease);
        else await rm(path.join(root, 'current'), { force: true });
      }
      await this.makeWritable(stagingDirectory).catch(() => undefined);
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (await this.exists(releaseDirectory)) {
        await this.makeWritable(releaseDirectory).catch(() => undefined);
        await rm(releaseDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (input.firstPublish && !previousRelease)
        await this.rollbackInitialPersistentState(input.websiteId, root, input.releaseId);
      throw error;
    }
  }

  async getStatus(websiteId: string, productionSlug: string): Promise<ProductionRuntime> {
    this.assertId(websiteId);
    this.assertSlug(productionSlug);
    const root = this.root(websiteId);
    await this.reconcileActivation(websiteId, productionSlug);
    const currentReleaseId = await this.readVerifiedRelease(root);
    try {
      await this.currentRelease(root);
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
    const container = this.docker.getContainer(this.containerName(websiteId));
    try {
      const info = await container.inspect();
      this.assertRuntimeMatches(info, websiteId, productionSlug);
      return this.runtime(
        websiteId,
        productionSlug,
        info.Id ?? container.id,
        info,
        currentReleaseId,
        await this.isAuthorizationComplete(websiteId),
      );
    } catch (error) {
      if (this.isNotFound(error))
        return {
          websiteId,
          status: 'missing',
          productionSlug,
          productionPort: null,
          containerRef: null,
          currentReleaseId,
          authorized: false,
        };
      throw error;
    }
  }

  async authorize(
    websiteId: string,
    productionSlug: string,
    authorizationCode: string,
  ): Promise<void> {
    this.assertId(websiteId);
    this.assertSlug(productionSlug);
    if (!authorizationCode.trim() || authorizationCode.length > 2048)
      throw new Error('INVALID_AUTHORIZATION_CODE');
    const canonicalHost = this.canonicalHost(productionSlug);
    const container = this.docker.getContainer(this.containerName(websiteId));
    let info: Docker.ContainerInspectInfo;
    try {
      info = await container.inspect();
    } catch {
      throw new Error('PRODUCTION_RUNTIME_UNAVAILABLE');
    }
    this.assertRuntimeMatches(info, websiteId, productionSlug);
    if (!info.State?.Running) throw new Error('PRODUCTION_RUNTIME_UNAVAILABLE');

    let output: string;
    let exitCode: number | null | undefined;
    try {
      const command = await container.exec({
        Cmd: ['cloudcrane-pboot-license'],
        Env: [`PBOOT_SN=${authorizationCode}`, 'PBOOT_SN_USER=', 'PBOOT_SITE_ROOT=/site/current'],
        WorkingDir: '/site/current',
        User: '1000:1000',
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const stream = await command.start({ hijack: true, stdin: false });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const outputPromise = readStream(stdout);
      const stderrPromise = readStream(stderr);
      const finishOutput = () => {
        stdout.end();
        stderr.end();
      };
      stream.once('end', finishOutput);
      stream.once('close', finishOutput);
      stream.once('error', (error) => {
        stdout.destroy(error);
        stderr.destroy(error);
      });
      this.docker.modem.demuxStream(stream, stdout, stderr);
      [output] = await Promise.all([outputPromise, stderrPromise]);
      const result = await command.inspect();
      exitCode = result.ExitCode;
    } catch {
      // Docker exec errors can include sensitive request metadata, so return a fixed safe error.
      throw new Error('PBOOT_AUTHORIZATION_UPDATE_FAILED');
    }
    if (exitCode !== 0) {
      const safeExitCode = [20, 21, 22, 23, 24].includes(exitCode ?? -1) ? exitCode : 'UNKNOWN';
      throw new Error(`PBOOT_AUTHORIZATION_UPDATE_FAILED:EXIT_${safeExitCode}`);
    }
    if (output.trim() !== 'AUTHORIZED')
      throw new Error('PBOOT_AUTHORIZATION_UPDATE_FAILED:OUTPUT_MISMATCH');

    const binding = info.NetworkSettings?.Ports?.['8080/tcp']?.[0];
    const port = binding?.HostPort ? Number(binding.HostPort) : null;
    if (!port || !(await this.verifyHost(port, canonicalHost))) {
      await rm(
        path.join(this.root(websiteId), 'shared', 'runtime', '.cloudcrane-authorization-v1'),
        { force: true },
      ).catch(() => undefined);
      throw new Error('PRODUCTION_AUTHORIZATION_VERIFY_FAILED');
    }
  }

  async destroyRuntime(websiteId: string, releaseIds: string[]): Promise<void> {
    this.assertId(websiteId);
    const container = this.docker.getContainer(this.containerName(websiteId));
    try {
      const info = await container.inspect();
      if (info.State?.Running) await container.stop().catch(() => undefined);
      await container.remove({ force: true });
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
    try {
      await this.docker.getNetwork(this.networkName(websiteId)).remove();
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
    const root = this.root(websiteId);
    const ownedReleaseIds = new Set(
      (
        await readdir(path.join(root, 'releases')).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        })
      ).filter((entry) => isReleaseId(entry)),
    );
    if (await this.exists(root)) {
      await this.restoreHostOwnership(websiteId, root);
      await this.makeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
    for (const releaseId of new Set(releaseIds)) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          releaseId,
        )
      )
        throw new Error('invalid release id for artifact cleanup');
      const artifact = this.artifactPath(`release-${releaseId}.zip`);
      const metadata = await this.readArtifactMetadata(`${artifact}.meta.json`);
      if (!ownedReleaseIds.has(releaseId) && metadata?.websiteId !== websiteId) continue;
      await rm(artifact, { force: true });
      await rm(`${artifact}.meta.json`, { force: true });
    }
    await this.removeWebsiteArtifacts(websiteId);
  }

  async snapshotContent(
    websiteId: string,
    productionSlug: string,
    refreshId: string,
  ): Promise<ProductionContentSnapshot> {
    this.assertId(websiteId);
    this.assertSlug(productionSlug);
    if (!/^[0-9a-f-]{36}$/i.test(refreshId)) throw new Error('invalid refresh id');
    const runtime = await this.getStatus(websiteId, productionSlug);
    if (runtime.status !== 'active' || !runtime.currentReleaseId || !runtime.authorized)
      throw new ProductionOperationError(
        'PRODUCTION_RUNTIME_UNAVAILABLE',
        'Production must be active and authorized before content can be refreshed',
      );

    const artifactRoot = path.resolve(this.config.releaseArtifactRoot);
    const directory = path.join(artifactRoot, `.production-refresh-${refreshId}`);
    if (!directory.startsWith(`${artifactRoot}${path.sep}`))
      throw new Error('production refresh snapshot path is outside its root');
    const temporaryDatabaseName = `.cloudcrane-refresh-${refreshId}.db`;
    const productionRoot = this.root(websiteId);
    const temporaryDatabase = path.join(productionRoot, 'shared', 'data', temporaryDatabaseName);
    const uploads = path.join(productionRoot, 'shared', 'upload');

    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const uploadInfo = await lstat(uploads);
      if (!uploadInfo.isDirectory() || uploadInfo.isSymbolicLink())
        throw new Error('Production uploads directory is not a regular directory');
      await this.assertNoSymlinks(uploads);
      const uploadsBefore = await this.hashDirectory(uploads);
      const container = this.docker.getContainer(this.containerName(websiteId));
      const php = [
        '$src = new SQLite3("/site/shared/data/cloudcrane.db", SQLITE3_OPEN_READONLY);',
        `$dst = new SQLite3("/site/shared/data/${temporaryDatabaseName}");`,
        '$dst->busyTimeout(30000);',
        '$ok = $src->backup($dst);',
        '$integrity = $ok ? $dst->querySingle("PRAGMA integrity_check") : false;',
        '$dst->close(); $src->close();',
        'if (!$ok || $integrity !== "ok") exit(42);',
      ].join(' ');
      const command = await container.exec({
        Cmd: ['php', '-r', php],
        User: '1000:1000',
        WorkingDir: '/site/current',
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const stream = await command.start({ hijack: true, stdin: false });
      await new Promise<void>((resolve, reject) => {
        stream.once('end', resolve);
        stream.once('close', resolve);
        stream.once('error', reject);
        stream.resume();
      });
      const result = await command.inspect();
      if (result.ExitCode !== 0) throw new Error('Production SQLite online backup failed');

      const databaseInfo = await lstat(temporaryDatabase);
      if (!databaseInfo.isFile() || databaseInfo.isSymbolicLink())
        throw new Error('Production SQLite online backup is not a regular file');
      await copyFile(temporaryDatabase, path.join(directory, 'pbootcms.db'));
      await rm(temporaryDatabase, { force: true });

      await cp(uploads, path.join(directory, 'upload'), {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      });
      const [uploadsAfter, snapshotUploads] = await Promise.all([
        this.hashDirectory(uploads),
        this.hashDirectory(path.join(directory, 'upload')),
      ]);
      if (uploadsBefore !== uploadsAfter || uploadsBefore !== snapshotUploads)
        throw new ProductionOperationError(
          'PRODUCTION_CONTENT_CHANGED_DURING_SNAPSHOT',
          'Production uploads changed while the content snapshot was being created',
        );

      const metrics = await this.measureDirectory(path.join(directory, 'upload'));
      return {
        directory,
        databaseBytes: (await stat(path.join(directory, 'pbootcms.db'))).size,
        uploadFiles: metrics.files,
        uploadBytes: metrics.bytes,
      };
    } catch (error) {
      await rm(temporaryDatabase, { force: true }).catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async removeContentSnapshot(
    snapshot: ProductionContentSnapshot,
    refreshId: string,
  ): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(refreshId)) throw new Error('invalid refresh id');
    const artifactRoot = path.resolve(this.config.releaseArtifactRoot);
    const expected = path.join(artifactRoot, `.production-refresh-${refreshId}`);
    if (path.resolve(snapshot.directory) !== expected)
      throw new Error('production refresh snapshot path does not match its refresh id');
    await rm(expected, { recursive: true, force: true });
  }

  private async completeInitialPersistentState(root: string, releaseId: string): Promise<void> {
    const shared = path.join(root, 'shared');
    const initializationMarker = path.join(shared, '.initializing-release');
    const owner = (await readFile(initializationMarker, 'utf8').catch(() => '')).trim();
    if (!owner && (await this.exists(path.join(shared, '.ownership-v1')))) return;
    if (owner !== releaseId)
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'First publish no longer owns the persistent-state initialization',
      );
    await writeFileSecure(path.join(shared, '.ownership-v1'), 'v1\n');
  }

  private async finalizeInitialPersistentState(root: string, releaseId: string): Promise<void> {
    const marker = path.join(root, 'shared', '.initializing-release');
    const owner = (await readFile(marker, 'utf8').catch(() => '')).trim();
    if (owner && owner !== releaseId)
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'First publish no longer owns the persistent-state initialization',
      );
    if (owner === releaseId) await rm(marker);
  }

  private async rollbackInitialPersistentState(
    websiteId: string,
    root: string,
    releaseId: string,
  ): Promise<void> {
    const shared = path.join(root, 'shared');
    const marker = path.join(shared, '.initializing-release');
    if ((await readFile(marker, 'utf8').catch(() => '')).trim() !== releaseId) return;
    if (await this.optionalCurrentRelease(root)) return;
    await this.stopRuntimeIfRunning(websiteId);
    await this.restoreHostOwnership(websiteId, root);
    await this.clearInitialPersistentState(root);
    await rm(marker, { force: true });
  }

  private async clearInitialPersistentState(root: string): Promise<void> {
    const shared = path.join(root, 'shared');
    for (const directory of ['data', 'upload', 'config', 'runtime']) {
      const target = path.join(shared, directory);
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(target))
        await rm(path.join(target, entry), { recursive: true, force: true });
    }
    await rm(path.join(shared, '.ownership-v1'), { force: true });
  }

  private async stopRuntimeIfRunning(websiteId: string): Promise<void> {
    const container = this.docker.getContainer(this.containerName(websiteId));
    try {
      const info = await container.inspect();
      if (info.State?.Running) await container.stop();
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
  }

  private async startRuntime(websiteId: string): Promise<void> {
    const container = this.docker.getContainer(this.containerName(websiteId));
    const info = await container.inspect();
    if (!info.State?.Running) await container.start();
  }

  private async collectOldReleases(
    websiteId: string,
    currentReleaseId: string,
    previousReleaseId: string | null,
  ): Promise<void> {
    const root = this.root(websiteId);
    const releaseRoot = path.join(root, 'releases');
    const releases = await readdir(releaseRoot, { withFileTypes: true });
    const directories: Array<{ id: string; modifiedAt: number }> = [];
    for (const entry of releases) {
      if (!entry.isDirectory() || !isReleaseId(entry.name)) continue;
      const info = await lstat(path.join(releaseRoot, entry.name));
      directories.push({ id: entry.name, modifiedAt: info.mtimeMs });
    }
    directories.sort((left, right) => right.modifiedAt - left.modifiedAt);
    const keep = new Set([
      currentReleaseId,
      ...(previousReleaseId ? [previousReleaseId] : []),
      ...directories.slice(0, this.config.productionKeepReleases).map((release) => release.id),
    ]);
    for (const release of directories) {
      if (keep.has(release.id)) continue;
      const directory = path.join(releaseRoot, release.id);
      await this.makeWritable(directory);
      await rm(directory, { recursive: true, force: true });
      const artifact = this.artifactPath(`release-${release.id}.zip`);
      const metadata = await this.readArtifactMetadata(`${artifact}.meta.json`);
      if (!metadata || (metadata.websiteId === websiteId && metadata.releaseId === release.id)) {
        await rm(artifact, { force: true });
        await rm(`${artifact}.meta.json`, { force: true });
      }
    }
    await this.collectExpiredWebsiteArtifacts(websiteId, keep);
  }

  private async collectExpiredWebsiteArtifacts(
    websiteId: string,
    keep: Set<string>,
  ): Promise<void> {
    const artifactRoot = path.resolve(this.config.releaseArtifactRoot);
    const entries = await readdir(artifactRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const now = Date.now();
    const gracePeriodMs = 7 * 24 * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!/^release-[0-9a-f-]{36}\.zip\.meta\.json$/i.test(entry)) continue;
      const metadataPath = path.join(artifactRoot, entry);
      const metadata = await this.readArtifactMetadata(metadataPath);
      if (!metadata || metadata.websiteId !== websiteId || keep.has(metadata.releaseId)) continue;
      if (now - Date.parse(metadata.createdAt) < gracePeriodMs) continue;
      const artifact = this.artifactPath(`release-${metadata.releaseId}.zip`);
      await rm(artifact, { force: true });
      await rm(metadataPath, { force: true });
    }
  }

  private async removeWebsiteArtifacts(websiteId: string): Promise<void> {
    const artifactRoot = path.resolve(this.config.releaseArtifactRoot);
    const entries = await readdir(artifactRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!/^release-[0-9a-f-]{36}\.zip\.meta\.json$/i.test(entry)) continue;
      const metadataPath = path.join(artifactRoot, entry);
      const metadata = await this.readArtifactMetadata(metadataPath);
      if (metadata?.websiteId !== websiteId) continue;
      await rm(this.artifactPath(`release-${metadata.releaseId}.zip`), { force: true });
      await rm(metadataPath, { force: true });
    }
  }

  private async readArtifactMetadata(
    filename: string,
  ): Promise<{ websiteId: string; releaseId: string; createdAt: string } | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(filename, 'utf8'));
      if (!value || typeof value !== 'object') return undefined;
      const metadata = value as Record<string, unknown>;
      if (
        typeof metadata.websiteId !== 'string' ||
        typeof metadata.releaseId !== 'string' ||
        !isReleaseId(metadata.releaseId) ||
        typeof metadata.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(metadata.createdAt))
      )
        return undefined;
      return {
        websiteId: metadata.websiteId,
        releaseId: metadata.releaseId,
        createdAt: metadata.createdAt,
      };
    } catch {
      return undefined;
    }
  }

  private async ensureLayout(root: string): Promise<void> {
    const ownershipProvisioned = await this.exists(path.join(root, 'shared', '.ownership-v1'));
    await mkdir(path.join(root, 'releases'), { recursive: true, mode: 0o750 });
    await chmod(root, 0o755);
    await chmod(path.join(root, 'releases'), 0o755);
    for (const directory of ['data', 'upload', 'config', 'runtime']) {
      await mkdir(path.join(root, 'shared', directory), { recursive: true, mode: 0o750 });
      if (!ownershipProvisioned)
        await chmod(path.join(root, 'shared', directory), directory === 'config' ? 0o750 : 0o770);
    }
    await chmod(path.join(root, 'shared'), 0o755);
  }

  private async provisionSharedOwnership(
    websiteId: string,
    root: string,
    force = false,
    persistMarker = true,
  ): Promise<void> {
    const marker = path.join(root, 'shared', '.ownership-v1');
    if (!force && (await this.exists(marker))) return;
    await chmod(path.join(root, 'shared', 'runtime'), 0o755);
    const helper = await this.docker.createContainer({
      Image: this.config.productionImage,
      name: `cloudcrane-production-owner-${websiteId}-${Date.now()}`,
      User: '0:0',
      Entrypoint: ['/bin/chown'],
      Cmd: [
        '-R',
        '1000:1000',
        '/shared/data',
        '/shared/upload',
        '/shared/config',
        '/shared/runtime',
      ],
      HostConfig: {
        Binds: [`${path.join(root, 'shared')}:/shared:rw`],
        NetworkMode: 'none',
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'DAC_READ_SEARCH'],
        AutoRemove: false,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '2m', 'max-file': '2' } },
      },
    });
    try {
      await helper.start();
      const result = await helper.wait();
      if (result.StatusCode !== 0)
        throw new Error(`Production shared ownership setup failed (${result.StatusCode})`);
      if (persistMarker && !(await this.exists(marker))) await writeFileSecure(marker, 'v1\n');
    } finally {
      await helper.remove({ force: true }).catch(() => undefined);
    }

    await this.reloadProductionPhpFpm(websiteId);
  }

  private async reloadProductionPhpFpm(websiteId: string): Promise<void> {
    const container = this.docker.getContainer(this.containerName(websiteId));
    const command = await container.exec({
      Cmd: [
        '/bin/sh',
        '-ec',
        `master_pid="$(ps -o pid,ppid,comm | awk '$2 == 1 && $3 == "php-fpm" {print $1; exit}')"; test -n "$master_pid"; kill -USR2 "$master_pid"`,
      ],
      User: '1000:1000',
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await command.start({ hijack: true, stdin: false });
    await new Promise<void>((resolve, reject) => {
      stream.once('end', resolve);
      stream.once('close', resolve);
      stream.once('error', reject);
      stream.resume();
    });
    if ((await command.inspect()).ExitCode !== 0)
      throw new Error('Production PHP worker refresh failed');
  }

  private async restoreHostOwnership(websiteId: string, root: string): Promise<void> {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
    const helper = await this.docker.createContainer({
      Image: this.config.productionImage,
      name: `cloudcrane-production-cleanup-${websiteId}-${Date.now()}`,
      User: '0:0',
      Entrypoint: ['/bin/chown'],
      Cmd: ['-R', `${uid}:${gid}`, '/production'],
      HostConfig: {
        Binds: [`${root}:/production:rw`],
        NetworkMode: 'none',
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'DAC_READ_SEARCH'],
        AutoRemove: false,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '2m', 'max-file': '2' } },
      },
    });
    try {
      await helper.start();
      const result = await helper.wait();
      if (result.StatusCode !== 0)
        throw new Error(`Production host ownership restore failed (${result.StatusCode})`);
    } finally {
      await helper.remove({ force: true }).catch(() => undefined);
    }
  }

  private async initializePersistentState(
    root: string,
    releaseDirectory: string,
    manifest: Awaited<ReturnType<typeof extractProductionReleaseArchive>>,
    firstPublish: boolean,
    releaseId: string,
  ): Promise<void> {
    const shared = path.join(root, 'shared');
    const database = path.join(shared, 'data', 'cloudcrane.db');
    const initialDatabase = path.join(releaseDirectory, 'data', 'pbootcms.db');
    if (firstPublish) {
      let restartingRuntime = false;
      const ownershipMarker = path.join(shared, '.ownership-v1');
      const initializationMarker = path.join(shared, '.initializing-release');
      if (await this.exists(ownershipMarker))
        throw new ProductionOperationError(
          'PRODUCTION_STATE_CONFLICT',
          'Shared production state is already provisioned',
        );
      if (await this.exists(initializationMarker)) {
        const owner = (await readFile(initializationMarker, 'utf8')).trim();
        if (owner !== releaseId)
          throw new ProductionOperationError(
            'PRODUCTION_STATE_CONFLICT',
            'Shared production state is owned by another initialization',
          );
        await this.stopRuntimeIfRunning(manifest.sourceWebsiteId);
        restartingRuntime = true;
        await this.clearInitialPersistentState(root);
      } else {
        if (
          (await readdir(path.join(shared, 'data'))).length > 0 ||
          (await readdir(path.join(shared, 'upload'))).length > 0 ||
          (await readdir(path.join(shared, 'config'))).length > 0
        )
          throw new ProductionOperationError(
            'PRODUCTION_STATE_CONFLICT',
            'Persistent production state already exists',
          );
        await writeFileSecure(initializationMarker, `${releaseId}\n`);
      }
      if (await this.exists(database))
        throw new ProductionOperationError(
          'PRODUCTION_STATE_CONFLICT',
          'Persistent production database already exists',
        );
      if (!manifest.files.entries.some((entry) => entry.path === 'data/pbootcms.db'))
        throw new Error('first publish archive is missing the SQLite database snapshot');
      const databaseInfo = await lstat(initialDatabase);
      if (!databaseInfo.isFile() || databaseInfo.isSymbolicLink())
        throw new Error('first publish SQLite snapshot is not a regular file');
      const initialUploads = path.join(releaseDirectory, 'static', 'upload');
      const initialSiteConfig = path.join(releaseDirectory, 'config', 'config.php');
      const siteConfigInfo = await lstat(initialSiteConfig).catch(() => undefined);
      if (!siteConfigInfo?.isFile() || siteConfigInfo.isSymbolicLink())
        throw new Error('first publish archive is missing the Pboot site configuration');
      if (await this.exists(initialUploads)) await this.assertNoSymlinks(initialUploads);
      const renderedDatabaseConfig = await this.renderDatabaseConfig();
      await copyFile(initialDatabase, database, constants.COPYFILE_EXCL);
      await chmod(database, 0o660);
      await this.copyTreeWithoutOverwrite(
        path.join(releaseDirectory, 'data'),
        path.join(shared, 'data'),
        new Set(['pbootcms.db']),
      );
      if (await this.exists(initialUploads))
        await this.copyTreeWithoutOverwrite(initialUploads, path.join(shared, 'upload'));
      await copyFile(
        initialSiteConfig,
        path.join(shared, 'config', 'config.php'),
        constants.COPYFILE_EXCL,
      );
      await writeFileSecure(path.join(shared, 'config', 'database.php'), renderedDatabaseConfig);
      await this.provisionSharedOwnership(manifest.sourceWebsiteId, root, true, false);
      if (restartingRuntime) await this.startRuntime(manifest.sourceWebsiteId);
    } else if (!(await this.exists(path.join(shared, '.ownership-v1')))) {
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'Production shared state is not provisioned',
      );
    }
  }

  private async renderDatabaseConfig(): Promise<string> {
    const baseRoot = this.config.managedPbootBaseRoot;
    if (!baseRoot) throw new Error('managed Pboot base path is not configured');
    const source = path.join(baseRoot, 'config', 'database.php');
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('trusted Pboot database configuration is not a regular file');
    const config = await readFile(source, 'utf8');
    if (!/['"]type['"]\s*=>\s*['"]sqlite['"]/.test(config))
      throw new Error('trusted Pboot database configuration is not SQLite');
    const databaseSetting = /^(\s*['"]dbname['"]\s*=>\s*)['"][^'"]*['"]/gm;
    const rewritten = config.replace(databaseSetting, "$1'/data/cloudcrane.db'");
    if (rewritten === config || [...config.matchAll(databaseSetting)].length !== 1)
      throw new Error('trusted Pboot database configuration has an unexpected shape');
    return rewritten;
  }

  private async installSharedLinks(
    root: string,
    stagingDirectory: string,
    finalReleaseDirectory: string,
  ): Promise<void> {
    await this.makeWritable(stagingDirectory);
    const links = [
      ['data', path.join(root, 'shared', 'data')],
      ['static/upload', path.join(root, 'shared', 'upload')],
      ['config/config.php', path.join(root, 'shared', 'config', 'config.php')],
      ['config/database.php', path.join(root, 'shared', 'config', 'database.php')],
      ['runtime', path.join(root, 'shared', 'runtime')],
    ] as const;
    for (const [relative, sharedPath] of links) {
      const target = path.join(stagingDirectory, relative);
      await rm(target, { recursive: true, force: true });
      await mkdir(path.dirname(target), { recursive: true });
      const finalPath = path.join(finalReleaseDirectory, relative);
      const linkTarget = path.relative(path.dirname(finalPath), sharedPath);
      await symlink(linkTarget, target, 'dir');
    }
  }

  private async copyTreeWithoutOverwrite(
    source: string,
    destination: string,
    excludedFiles: ReadonlySet<string> = new Set(),
    relativeDirectory = '',
  ): Promise<void> {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('initial persistent state contains a symlink');
      if (excludedFiles.has(relativePath)) continue;
      if (entry.isDirectory()) {
        await mkdir(to, { recursive: false, mode: 0o770 });
        await this.copyTreeWithoutOverwrite(from, to, excludedFiles, relativePath);
      } else if (entry.isFile()) {
        await copyFile(from, to, constants.COPYFILE_EXCL);
        await chmod(to, 0o660);
      }
    }
  }

  private async assertNoSymlinks(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('initial upload contains a symlink');
      if (entry.isDirectory()) await this.assertNoSymlinks(path.join(directory, entry.name));
    }
  }

  private async measureDirectory(directory: string): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Production uploads contain a symbolic link');
      if (entry.isDirectory()) {
        const nested = await this.measureDirectory(filename);
        files += nested.files;
        bytes += nested.bytes;
      } else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(filename)).size;
      } else {
        throw new Error('Production uploads contain an unsupported filesystem entry');
      }
    }
    return { files, bytes };
  }

  private async hashDirectory(directory: string, relative = ''): Promise<string> {
    const hash = createHash('sha256');
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const filename = path.join(directory, entry.name);
      const relativePath = path.posix.join(relative, entry.name);
      hash.update(`${entry.isDirectory() ? 'd' : entry.isFile() ? 'f' : 'x'}:${relativePath}\n`);
      if (entry.isSymbolicLink()) throw new Error('Production uploads contain a symbolic link');
      if (entry.isDirectory()) {
        hash.update(await this.hashDirectory(filename, relativePath));
      } else if (entry.isFile()) {
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(filename);
          stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
          stream.once('end', resolve);
          stream.once('error', reject);
        });
      } else {
        throw new Error('Production uploads contain an unsupported filesystem entry');
      }
    }
    return hash.digest('hex');
  }

  private async makeReleaseReadOnly(root: string): Promise<void> {
    await this.makeReadOnly(root);
  }

  private async makeReadOnly(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }))
      if (entry.isDirectory()) await this.makeReadOnly(path.join(directory, entry.name));
    await chmod(directory, 0o555);
  }

  private async makeWritable(root: string): Promise<void> {
    const info = await lstat(root).catch(() => undefined);
    if (!info || !info.isDirectory() || info.isSymbolicLink()) return;
    await chmod(root, 0o755);
    for (const entry of await readdir(root, { withFileTypes: true }))
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await this.makeWritable(path.join(root, entry.name));
  }

  private async inspectRuntime(
    websiteId: string,
    productionSlug: string,
  ): Promise<ProductionRuntime> {
    const container = this.docker.getContainer(this.containerName(websiteId));
    const info = await container.inspect();
    this.assertRuntimeMatches(info, websiteId, productionSlug);
    const root = this.root(websiteId);
    const productionPort = this.runtimePort(info);
    if (productionPort) await this.persistProductionPort(root, productionPort);
    return this.runtime(
      websiteId,
      productionSlug,
      info.Id ?? container.id,
      info,
      await this.readVerifiedRelease(root),
      await this.isAuthorizationComplete(websiteId),
    );
  }

  private async readProductionPort(root: string): Promise<number | undefined> {
    const filename = path.join(root, '.production-port');
    try {
      const value = (await readFile(filename, 'utf8')).trim();
      const port = Number(value);
      return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined;
    } catch {
      return undefined;
    }
  }

  private async persistProductionPort(root: string, port: number): Promise<void> {
    const filename = path.join(root, '.production-port');
    const current = await this.readProductionPort(root);
    if (current === port) return;
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    await writeFileSecure(temporary, `${port}\n`);
    await rename(temporary, filename);
  }

  private runtimePort(info: Docker.ContainerInspectInfo): number | undefined {
    const value = Number(info.NetworkSettings?.Ports?.['8080/tcp']?.[0]?.HostPort);
    return Number.isInteger(value) && value >= 1 && value <= 65_535 ? value : undefined;
  }

  private runtime(
    websiteId: string,
    productionSlug: string,
    containerRef: string,
    info: Docker.ContainerInspectInfo,
    currentReleaseId?: string | null,
    authorized = false,
  ): ProductionRuntime {
    const binding = info.NetworkSettings?.Ports?.['8080/tcp']?.[0];
    return {
      websiteId,
      status: info.State?.Running
        ? currentReleaseId
          ? authorized
            ? 'active'
            : 'authorization_required'
          : 'provisioning'
        : 'stopped',
      productionSlug,
      productionPort: binding?.HostPort ? Number(binding.HostPort) : null,
      containerRef,
      currentReleaseId: currentReleaseId ?? null,
      authorized,
    };
  }

  private assertRuntimeMatches(
    info: Docker.ContainerInspectInfo,
    websiteId: string,
    productionSlug: string,
  ): void {
    const labels = info.Config?.Labels ?? {};
    const bindings = info.HostConfig?.PortBindings?.['8080/tcp'] ?? [];
    const binds = info.HostConfig?.Binds ?? [];
    if (
      labels['cloudcrane.service'] !== 'production' ||
      labels['cloudcrane.website_id'] !== websiteId ||
      labels['cloudcrane.production_slug'] !== productionSlug ||
      info.Config?.Image !== this.config.productionImage ||
      info.Config?.User !== '1000:1000' ||
      info.Config?.WorkingDir !== '/site' ||
      info.HostConfig?.Privileged !== false ||
      info.HostConfig?.ReadonlyRootfs !== true ||
      !info.HostConfig?.SecurityOpt?.includes('no-new-privileges:true') ||
      !info.HostConfig?.CapDrop?.includes('ALL') ||
      (info.HostConfig?.PidsLimit ?? 0) <= 0 ||
      bindings.length === 0 ||
      (bindings as Array<{ HostIp?: string | null }>).some(
        (binding) => binding.HostIp !== '127.0.0.1',
      ) ||
      binds.some((bind) => bind.includes('docker.sock'))
    )
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'Production runtime security configuration drifted',
      );
  }

  private async healthCheck(port: number | null, canonicalHost: string): Promise<boolean> {
    if (!port) return false;
    try {
      const response = await this.fetcher(`http://127.0.0.1:${port}/_cloudcrane/health`, {
        headers: {
          host: canonicalHost,
          'x-forwarded-host': canonicalHost,
          'x-forwarded-proto': 'https',
        },
        signal: AbortSignal.timeout(5_000),
        redirect: 'manual',
      });
      return response.status === 204;
    } catch {
      return false;
    }
  }

  private async refreshPbootReleaseState(websiteId: string, productionRoot: string): Promise<void> {
    const helper = await this.docker.createContainer({
      Image: this.config.productionImage,
      name: `cloudcrane-production-cache-${websiteId}-${Date.now()}`,
      User: '1000:1000',
      Entrypoint: ['/bin/rm'],
      Cmd: ['-rf', '/runtime/cache', '/runtime/complile'],
      HostConfig: {
        Binds: [`${path.join(productionRoot, 'shared', 'runtime')}:/runtime:rw`],
        NetworkMode: 'none',
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        AutoRemove: false,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '2m', 'max-file': '2' } },
      },
    });
    try {
      await helper.start();
      const result = await helper.wait();
      if (result.StatusCode !== 0) throw new Error('Production Pboot cache cleanup failed');
    } finally {
      await helper.remove({ force: true }).catch(() => undefined);
    }
    await this.reloadProductionPhpFpm(websiteId);
  }

  private async verifyHost(port: number, canonicalHost: string): Promise<boolean> {
    try {
      const response = await this.fetcher(`http://127.0.0.1:${port}/`, {
        headers: {
          host: canonicalHost,
          'x-forwarded-host': canonicalHost,
          'x-forwarded-proto': 'https',
        },
        signal: AbortSignal.timeout(20_000),
        redirect: 'manual',
      });
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    }
  }

  private canonicalHost(productionSlug: string): string {
    const hostSuffix = this.config.productionHostSuffix;
    if (!hostSuffix) throw new Error('PRODUCTION_HOST_SUFFIX is not configured');
    return `${productionSlug}.${hostSuffix}`;
  }

  private async isAuthorizationComplete(websiteId: string): Promise<boolean> {
    const marker = path.join(
      this.root(websiteId),
      'shared',
      'runtime',
      '.cloudcrane-authorization-v1',
    );
    const info = await lstat(marker).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    return Boolean(info?.isFile() && !info.isSymbolicLink());
  }

  private async waitForHealth(port: number | null, productionSlug: string): Promise<boolean> {
    const canonicalHost = this.canonicalHost(productionSlug);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await this.healthCheck(port, canonicalHost)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  private async currentRelease(root: string): Promise<string | null> {
    const link = await readlink(path.join(root, 'current'));
    const match = /^releases\/([0-9a-f-]{36})$/i.exec(link.replaceAll('\\', '/'));
    if (!match) throw new Error('current production release symlink is invalid');
    return match[1] ?? null;
  }

  private async optionalCurrentRelease(root: string): Promise<string | null> {
    try {
      return await this.currentRelease(root);
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  private async readVerifiedRelease(root: string): Promise<string | null> {
    const value = await readFile(path.join(root, 'shared', '.verified-release'), 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      },
    );
    const releaseId = value.trim();
    if (!releaseId) return null;
    if (!isReleaseId(releaseId)) throw new Error('verified production release marker is invalid');
    return releaseId;
  }

  private async writeVerifiedRelease(root: string, releaseId: string): Promise<void> {
    if (!isReleaseId(releaseId)) throw new Error('invalid verified production release id');
    const shared = path.join(root, 'shared');
    const marker = path.join(shared, '.verified-release');
    const temporary = path.join(shared, `.verified-release-${process.pid}-${Date.now()}`);
    const file = await (await import('node:fs/promises')).open(temporary, 'wx', 0o640);
    try {
      await file.writeFile(`${releaseId}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, marker);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async reconcileActivation(websiteId: string, productionSlug: string): Promise<void> {
    const root = this.root(websiteId);
    const current = await this.optionalCurrentRelease(root);
    const verified = await this.readVerifiedRelease(root);
    if (current === verified) {
      if (current) {
        const initializingRelease = (
          await readFile(path.join(root, 'shared', '.initializing-release'), 'utf8').catch(() => '')
        ).trim();
        if (initializingRelease === current)
          await this.finalizeInitialPersistentState(root, current);
      }
      return;
    }

    const container = this.docker.getContainer(this.containerName(websiteId));
    let info: Docker.ContainerInspectInfo;
    try {
      info = await container.inspect();
    } catch (error) {
      if (this.isNotFound(error)) return;
      throw error;
    }
    this.assertRuntimeMatches(info, websiteId, productionSlug);
    if (!info.State?.Running) {
      await container.start();
      info = await container.inspect();
    }
    const binding = info.NetworkSettings?.Ports?.['8080/tcp']?.[0];
    const port = binding?.HostPort ? Number(binding.HostPort) : null;
    if (current && (await this.waitForHealth(port, productionSlug))) {
      const initializingRelease = (
        await readFile(path.join(root, 'shared', '.initializing-release'), 'utf8').catch(() => '')
      ).trim();
      if (initializingRelease === current) await this.completeInitialPersistentState(root, current);
      await this.writeVerifiedRelease(root, current);
      if (initializingRelease === current) await this.finalizeInitialPersistentState(root, current);
      logger.info(
        { event: 'production.release.recovered', websiteId, releaseId: current },
        'verified interrupted production activation',
      );
      return;
    }

    if (verified) {
      if (current !== verified) await switchCurrentRelease(root, verified);
      if (!(await this.waitForHealth(port, productionSlug)))
        throw new ProductionOperationError(
          'PRODUCTION_HEALTHCHECK_FAILED',
          'The previously verified production release did not recover',
        );
      if (current && current !== verified) {
        const failedDirectory = path.join(root, 'releases', current);
        await this.makeWritable(failedDirectory).catch(() => undefined);
        await rm(failedDirectory, { recursive: true, force: true });
      }
      logger.warn(
        { event: 'production.release.recovered.rollback', websiteId, releaseId: current },
        'restored the previously verified production release after an interrupted activation',
      );
      return;
    }

    const initializationOwner = (
      await readFile(path.join(root, 'shared', '.initializing-release'), 'utf8').catch(() => '')
    ).trim();
    if (current && initializationOwner === current) {
      await rm(path.join(root, 'current'), { force: true });
      await this.rollbackInitialPersistentState(websiteId, root, current);
      const failedDirectory = path.join(root, 'releases', current);
      await this.makeWritable(failedDirectory).catch(() => undefined);
      await rm(failedDirectory, { recursive: true, force: true });
      logger.warn(
        { event: 'production.release.recovery.failed', websiteId, releaseId: current },
        'removed an unverified first production release after health check failure',
      );
    }
  }

  private artifactPath(storageKey: string): string {
    if (!/^release-[0-9a-f-]{36}\.zip$/i.test(storageKey))
      throw new Error('invalid production artifact storage key');
    const root = path.resolve(this.config.releaseArtifactRoot);
    const target = path.resolve(root, storageKey);
    if (!target.startsWith(`${root}${path.sep}`))
      throw new Error('artifact path escaped storage root');
    return target;
  }

  private root(websiteId: string): string {
    return path.join(path.resolve(this.config.productionRoot), websiteId);
  }

  private containerName(websiteId: string): string {
    return `cloudcrane-production-${websiteId}`;
  }

  private networkName(websiteId: string): string {
    return `cloudcrane-production-${websiteId}`;
  }

  private assertId(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new Error('invalid production identity');
  }

  private assertSlug(slug: string): void {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug))
      throw new Error('invalid production slug');
  }

  private async exists(filename: string): Promise<boolean> {
    try {
      await lstat(filename);
      return true;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    return (
      (typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        (error as { statusCode?: number }).statusCode === 404) ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'ENOENT')
    );
  }
}

async function writeFileSecure(filename: string, contents: string): Promise<void> {
  const { open, mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(filename), { recursive: true });
  const file = await open(filename, 'wx', 0o440);
  try {
    await file.writeFile(contents, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}

function isReleaseId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
