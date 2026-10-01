import { constants } from 'node:fs';
import { PassThrough, type Readable } from 'node:stream';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import Docker from 'dockerode';
import { extractProductionReleaseArchive } from '@cloudcrane/pboot-snapshot';
import type { RunnerConfig } from '../../config.js';
import type {
  ProductionDeployInput,
  ProductionProvider,
  ProductionRuntime,
} from '../../ports/production-provider.js';

type CurrentLinkOperations = Pick<typeof import('node:fs/promises'), 'symlink' | 'rename'>;

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
  ) {}

  async ensureRuntime(websiteId: string, productionSlug: string): Promise<ProductionRuntime> {
    this.assertId(websiteId);
    this.assertSlug(productionSlug);
    const root = this.root(websiteId);
    await this.ensureLayout(root);
    const slugPath = path.join(root, '.production-slug');
    if (await this.exists(slugPath)) {
      if ((await readFile(slugPath, 'utf8')) !== productionSlug)
        throw new Error('PRODUCTION_STATE_CONFLICT: production slug does not match runtime');
    } else {
      await writeFileSecure(slugPath, productionSlug);
    }
    const containerName = this.containerName(websiteId);
    const container = this.docker.getContainer(containerName);
    let info: Docker.ContainerInspectInfo | undefined;
    try {
      info = await container.inspect();
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
    if (!info) {
      const networkName = this.networkName(websiteId);
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
            PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }] },
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
            LogConfig: {
              Type: 'json-file',
              Config: { 'max-size': '10m', 'max-file': '5' },
            },
          },
        });
        try {
          await created.start();
          info = await created.inspect();
        } catch (error) {
          await created.remove({ force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        await network?.remove().catch(() => undefined);
        throw error;
      }
    } else if (info.State?.Running !== true) {
      this.assertRuntimeMatches(info, websiteId, productionSlug);
      await container.start();
      info = await container.inspect();
    } else {
      this.assertRuntimeMatches(info, websiteId, productionSlug);
    }
    return this.runtime(
      websiteId,
      productionSlug,
      info.Id ?? container.id,
      info,
      await this.optionalCurrentRelease(root),
      await this.isAuthorizationComplete(websiteId),
    );
  }

  async deployRelease(input: ProductionDeployInput): Promise<ProductionRuntime> {
    this.assertId(input.websiteId);
    this.assertId(input.releaseId);
    this.assertSlug(input.productionSlug);
    const root = this.root(input.websiteId);
    await this.ensureLayout(root);
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
    const previousRelease = await this.optionalCurrentRelease(root);
    if (input.firstPublish && previousRelease)
      throw new Error('PRODUCTION_STATE_CONFLICT: first publish cannot replace an active release');
    if (!input.firstPublish && !previousRelease)
      throw new Error('PRODUCTION_STATE_CONFLICT: production runtime has no current release');
    if (await this.exists(releaseDirectory))
      throw new Error('PRODUCTION_STATE_CONFLICT: release directory already exists');

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
      await this.initializePersistentState(root, stagingDirectory, manifest, input.firstPublish);
      await this.installSharedLinks(root, stagingDirectory, releaseDirectory);
      await rename(stagingDirectory, releaseDirectory);
      await this.makeReleaseReadOnly(releaseDirectory);
      await switchCurrentRelease(root, input.releaseId);
      switched = true;
      const runtime = await this.inspectRuntime(input.websiteId, input.productionSlug);
      if (!(await this.waitForHealth(runtime.productionPort)))
        throw new Error('PRODUCTION_HEALTHCHECK_FAILED: production runtime health check failed');
      const authorized = await this.isAuthorizationComplete(input.websiteId);
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
      throw error;
    }
  }

  async getStatus(websiteId: string, productionSlug: string): Promise<ProductionRuntime> {
    this.assertId(websiteId);
    this.assertSlug(productionSlug);
    const root = this.root(websiteId);
    let currentReleaseId: string | null = null;
    try {
      currentReleaseId = await this.currentRelease(root);
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
    const hostSuffix = this.config.productionHostSuffix;
    if (!hostSuffix) throw new Error('PRODUCTION_HOST_SUFFIX is not configured');
    const canonicalHost = `${productionSlug}.${hostSuffix}`;
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

  async destroyRuntime(websiteId: string): Promise<void> {
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
    if (await this.exists(root)) {
      await this.restoreHostOwnership(websiteId, root);
      await this.makeWritable(root);
      await rm(root, { recursive: true, force: true });
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
  ): Promise<void> {
    const marker = path.join(root, 'shared', '.ownership-v1');
    if (!force && (await this.exists(marker))) return;
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
      if (!(await this.exists(marker))) await writeFileSecure(marker, 'v1\n');
    } finally {
      await helper.remove({ force: true }).catch(() => undefined);
    }
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
  ): Promise<void> {
    const shared = path.join(root, 'shared');
    const database = path.join(shared, 'data', 'pbootcms.db');
    const initialDatabase = path.join(releaseDirectory, 'data', 'pbootcms.db');
    if (firstPublish) {
      if (await this.exists(path.join(shared, '.ownership-v1')))
        throw new Error(
          'PRODUCTION_STATE_CONFLICT: shared production state is already provisioned',
        );
      if (await this.exists(database))
        throw new Error('PRODUCTION_STATE_CONFLICT: persistent database already exists');
      if (
        (await readdir(path.join(shared, 'upload'))).length > 0 ||
        (await readdir(path.join(shared, 'config'))).length > 0
      )
        throw new Error('PRODUCTION_STATE_CONFLICT: persistent production files already exist');
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
      await this.provisionSharedOwnership(manifest.sourceWebsiteId, root, true);
    } else if (!(await this.exists(path.join(shared, '.ownership-v1')))) {
      throw new Error('PRODUCTION_STATE_CONFLICT: production shared state is not provisioned');
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
    const databaseSetting = /(['"]dbname['"]\s*=>\s*)['"][^'"]*['"]/g;
    const rewritten = config.replace(databaseSetting, "$1'/site/shared/data/pbootcms.db'");
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
    return this.runtime(
      websiteId,
      productionSlug,
      info.Id ?? container.id,
      info,
      await this.optionalCurrentRelease(root),
      await this.isAuthorizationComplete(websiteId),
    );
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
      throw new Error('PRODUCTION_STATE_CONFLICT: runtime security configuration drifted');
  }

  private async healthCheck(port: number | null): Promise<boolean> {
    if (!port) return false;
    try {
      const response = await this.fetcher(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(5_000),
        redirect: 'manual',
      });
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    }
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

  private async isAuthorizationComplete(websiteId: string): Promise<boolean> {
    const container = this.docker.getContainer(this.containerName(websiteId));
    try {
      const command = await container.exec({
        Cmd: ['test', '-f', '/site/shared/runtime/.cloudcrane-authorization-v1'],
        User: '1000:1000',
        AttachStdout: false,
        AttachStderr: false,
      });
      const stream = await command.start({ hijack: false, stdin: false });
      await readStream(stream);
      const result = await command.inspect();
      return result.ExitCode === 0;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw error;
    }
  }

  private async waitForHealth(port: number | null): Promise<boolean> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await this.healthCheck(port)) return true;
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

async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
