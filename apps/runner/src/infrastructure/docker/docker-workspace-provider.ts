import { chmod, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import Docker from 'dockerode';
import { z } from 'zod';
import { buildSnapshotArchive } from '@cloudcrane/pboot-snapshot';
import { WorkspaceDaemonClient } from '../daemon/workspace-daemon-client.js';
import { WorkspaceQuotaManager } from './workspace-quota-manager.js';
import type { RunnerConfig } from '../../config.js';
import { ProductionOperationError } from '../../ports/production-operation-error.js';
import type {
  SnapshotStageInput,
  SnapshotStageResult,
  ProductionContentImport,
  ProductionContentImportResult,
  WorkspaceProvider,
  WorkspaceRuntime,
} from '../../ports/workspace-provider.js';

export class DockerWorkspaceProvider implements WorkspaceProvider {
  private readonly reconciliationLocks = new Map<string, Promise<Docker.Container>>();
  private readonly reconcilingWorkspaces = new Set<string>();
  private readonly quotaManager?: WorkspaceQuotaManager;

  constructor(
    private readonly config: RunnerConfig,
    private readonly docker = new Docker(),
  ) {
    const workspaceDiskLimitBytes = config.workspaceDiskLimitBytes ?? 0;
    this.quotaManager =
      workspaceDiskLimitBytes > 0
        ? new WorkspaceQuotaManager(config.workspaceRoot, workspaceDiskLimitBytes)
        : undefined;
  }

  async create(workspaceId: string): Promise<WorkspaceRuntime> {
    this.assertWorkspaceId(workspaceId);
    const persistentPath = this.persistentPath(workspaceId);
    await mkdir(persistentPath, { recursive: true });
    await mkdir(`${persistentPath}/.cloudcrane`, { recursive: true });
    await this.quotaManager?.ensure(workspaceId, persistentPath);
    await this.provisionWorkspaceOwnership(persistentPath, workspaceId);
    const referencePath = await this.referencePath(workspaceId);
    const network = await this.docker.createNetwork({
      Name: `cloudcrane-workspace-${workspaceId}`,
      Driver: 'bridge',
      Internal: false,
    });
    let container: Docker.Container | undefined;
    try {
      container = await this.docker.createContainer({
        Image: this.config.workspaceImage,
        name: `cloudcrane-workspace-${workspaceId}`,
        User: '1000:1000',
        WorkingDir: '/workspace',
        Env: [
          `WORKSPACE_ID=${workspaceId}`,
          'WORKSPACE_DAEMON_PORT=7070',
          'WORKSPACE_DAEMON_HOST=0.0.0.0',
        ],
        ExposedPorts: { '7070/tcp': {}, '8080/tcp': {} },
        Labels: {
          'cloudcrane.service': 'workspace',
          'cloudcrane.environment':
            process.env.CLOUDCRANE_ENV ?? process.env.NODE_ENV ?? 'development',
        },
        HostConfig: {
          Binds: [
            `${persistentPath}:/workspace`,
            ...(referencePath ? [`${referencePath}:/workspace/.cloudcrane/references:ro`] : []),
          ],
          NetworkMode: network.id,
          PortBindings: {
            '7070/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }],
            '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }],
          },
          Privileged: false,
          PidMode: '',
          IpcMode: 'private',
          SecurityOpt: ['no-new-privileges:true'],
          NanoCpus: this.config.cpuLimit,
          Memory: this.config.memoryLimitBytes,
          PidsLimit: this.config.pidsLimit,
          AutoRemove: false,
          LogConfig: {
            Type: 'json-file',
            Config: { 'max-size': '10m', 'max-file': '5' },
          },
        },
      });
      await container.start();
      await this.waitForPreview(container);
      return this.runtime(workspaceId, container.id, 'running');
    } catch (error) {
      await container?.remove({ force: true }).catch(() => undefined);
      await this.restoreHostOwnership(persistentPath).catch(() => undefined);
      await network.remove().catch(() => undefined);
      throw error;
    }
  }

  async start(workspaceId: string): Promise<WorkspaceRuntime> {
    await this.recoverPendingProductionRefresh(workspaceId);
    const container = await this.ensureRuntimeCompatible(workspaceId);
    const info = await container.inspect();
    if (!info.State?.Running) await container.start();
    await this.waitForPreview(container);
    return this.runtime(workspaceId, container.id, 'running');
  }
  async stop(workspaceId: string): Promise<WorkspaceRuntime> {
    const container = await this.container(workspaceId);
    await container.stop();
    return { workspaceId, containerRef: container.id, status: 'stopped' };
  }

  async getStatus(workspaceId: string): Promise<WorkspaceRuntime> {
    const container = await this.ensureRuntimeCompatible(workspaceId);
    const info = await container.inspect();
    const status = info.State?.Running ? 'running' : 'stopped';
    return this.runtime(workspaceId, container.id, status);
  }

  async getEndpoint(workspaceId: string): Promise<string> {
    await this.recoverPendingProductionRefresh(workspaceId);
    const container = this.reconcilingWorkspaces.has(workspaceId)
      ? await this.container(workspaceId)
      : await this.ensureRuntimeCompatible(workspaceId);
    const info = await container.inspect();
    const binding = info.NetworkSettings?.Ports?.['7070/tcp']?.[0];
    if (!binding?.HostPort) throw new Error('Workspace daemon endpoint is unavailable');
    return `http://127.0.0.1:${binding.HostPort}`;
  }

  async destroyRuntime(workspaceId: string): Promise<void> {
    const persistentPath = this.persistentPath(workspaceId);
    const projectIdMarker = path.join(path.dirname(persistentPath), '.workspace-project-id');
    const projectIdRaw = await readFile(projectIdMarker, 'utf8').catch(() => undefined);
    const projectId =
      projectIdRaw && /^[1-9]\d{0,9}$/.test(projectIdRaw.trim())
        ? Number(projectIdRaw.trim())
        : undefined;
    let container: Docker.Container | undefined;
    try {
      container = await this.container(workspaceId);
      const info = await container.inspect();
      if (info.State?.Running) await container.stop().catch(() => undefined);
      await container.remove({ force: true }).catch((error) => {
        if (!this.isNotFound(error)) throw error;
      });
      if (info.HostConfig?.NetworkMode) {
        await this.docker
          .getNetwork(info.HostConfig.NetworkMode)
          .remove()
          .catch((error) => {
            if (!this.isNotFound(error)) throw error;
          });
      }
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    } finally {
      await this.removeWorkspaceFiles(workspaceId);
      if (projectId !== undefined) await this.quotaManager?.release(projectId);
      await this.docker
        .getNetwork(`cloudcrane-workspace-${workspaceId}`)
        .remove()
        .catch((error) => {
          if (!this.isNotFound(error)) throw error;
        });
    }
  }

  async stageSnapshot(
    workspaceId: string,
    input: SnapshotStageInput,
  ): Promise<SnapshotStageResult> {
    const artifactRoot = this.config.templateArtifactRoot;
    const managedBaseRoot = this.config.managedPbootBaseRoot;
    if (!artifactRoot || !managedBaseRoot)
      throw new Error('snapshot staging paths are not configured');
    const workspaceRoot = this.persistentPath(workspaceId);
    const daemon = new WorkspaceDaemonClient(await this.getEndpoint(workspaceId));
    const integrity = await daemon.exec({
      command: 'sqlite3',
      args: ['/workspace/data/pbootcms.db', 'PRAGMA integrity_check;'],
      cwd: '/workspace',
      env: {},
      timeoutMs: 30_000,
      maxOutputBytes: 16_384,
      executionId: randomUUID(),
    });
    if (integrity.exitCode !== 0 || integrity.stdout.trim() !== 'ok')
      throw new Error('source Pboot database integrity check failed');
    const resolvedRoot = path.resolve(artifactRoot);
    const outputPath = path.resolve(resolvedRoot, input.artifactStorageKey);
    if (!outputPath.startsWith(`${resolvedRoot}${path.sep}`))
      throw new Error('snapshot artifact path is outside the artifact root');
    await mkdir(resolvedRoot, { recursive: true });
    const result = await buildSnapshotArchive({
      workspaceRoot,
      managedBaseRoot,
      sourceWebsiteId: input.sourceWebsiteId,
      sourcePbootVersion: input.sourcePbootVersion,
      sourceCoreCommit: input.sourceCoreCommit,
      dbSchemaVersion: input.dbSchemaVersion,
      outputPath,
    });
    await chmod(outputPath, 0o440);
    return {
      artifactStorageKey: input.artifactStorageKey,
      artifactSha256: result.sha256,
      artifactSize: result.size,
      manifest: result.manifest,
    };
  }

  async importProductionContent(
    workspaceId: string,
    input: ProductionContentImport,
  ): Promise<ProductionContentImportResult> {
    this.assertWorkspaceId(workspaceId);
    this.assertRefreshId(input.refreshId);
    const artifactRoot = path.resolve(this.config.releaseArtifactRoot);
    const snapshotDirectory = path.resolve(input.snapshotDirectory);
    if (!snapshotDirectory.startsWith(`${artifactRoot}${path.sep}`))
      throw new Error('production refresh snapshot is outside the artifact root');
    const snapshotDirectoryInfo = await lstat(snapshotDirectory);
    if (!snapshotDirectoryInfo.isDirectory() || snapshotDirectoryInfo.isSymbolicLink())
      throw new Error('Production refresh snapshot is not a regular directory');
    const sourceDatabase = path.join(snapshotDirectory, 'pbootcms.db');
    const sourceUploads = path.join(snapshotDirectory, 'upload');
    const sourceDatabaseInfo = await lstat(sourceDatabase);
    const sourceUploadsInfo = await lstat(sourceUploads);
    if (!sourceDatabaseInfo.isFile() || sourceDatabaseInfo.isSymbolicLink())
      throw new Error('Production snapshot database is not a regular file');
    if (!sourceUploadsInfo.isDirectory() || sourceUploadsInfo.isSymbolicLink())
      throw new Error('Production snapshot uploads are not a regular directory');
    await this.assertTreeHasNoSymlinks(sourceUploads);

    await this.recoverPendingProductionRefresh(workspaceId);
    const workspaceRoot = this.persistentPath(workspaceId);
    const pendingMarker = path.join(workspaceRoot, '.cloudcrane', 'production-refresh-pending');
    const databasePath = path.join(workspaceRoot, 'data', 'pbootcms.db');
    const uploadsPath = path.join(workspaceRoot, 'static', 'upload');
    const initialRuntime = await this.getStatus(workspaceId);
    const wasRunning = initialRuntime.status === 'running';
    await this.start(workspaceId);
    const endpoint = await this.getEndpoint(workspaceId);
    const daemon = new WorkspaceDaemonClient(endpoint, 60_000);

    try {
      await this.runProductionRefreshFilesystemHelper(
        workspaceId,
        input.refreshId,
        [
          'refresh_root="/workspace/.cloudcrane/production-refresh-' + input.refreshId + '"',
          'rm -rf "$refresh_root"',
          'mkdir -p "$refresh_root/incoming"',
          'cp /production-snapshot/pbootcms.db "$refresh_root/incoming/pbootcms.db"',
          'cp -a /production-snapshot/upload "$refresh_root/incoming/upload"',
          'chown -R 1000:1000 "$refresh_root/incoming"',
        ].join('\n'),
        snapshotDirectory,
      );
      const integrity = await daemon.exec({
        command: 'sqlite3',
        args: [
          `/workspace/.cloudcrane/production-refresh-${input.refreshId}/incoming/pbootcms.db`,
          'PRAGMA integrity_check;',
        ],
        cwd: '/workspace',
        env: {},
        timeoutMs: 60_000,
        maxOutputBytes: 16_384,
        executionId: randomUUID(),
      });
      if (integrity.exitCode !== 0 || integrity.stdout.trim() !== 'ok')
        throw new Error('Production snapshot database integrity check failed');
      const stripProductionOperationLedger = await daemon.exec({
        command: 'sqlite3',
        args: [
          `/workspace/.cloudcrane/production-refresh-${input.refreshId}/incoming/pbootcms.db`,
          'DROP TABLE IF EXISTS cloudcrane_cms_content_create_ops;',
        ],
        cwd: '/workspace',
        env: {},
        timeoutMs: 30_000,
        maxOutputBytes: 4096,
        executionId: randomUUID(),
      });
      if (stripProductionOperationLedger.exitCode !== 0)
        throw new Error('Production-only operation metadata cleanup failed');
      const cleanedIntegrity = await daemon.exec({
        command: 'sqlite3',
        args: [
          `/workspace/.cloudcrane/production-refresh-${input.refreshId}/incoming/pbootcms.db`,
          'PRAGMA integrity_check;',
        ],
        cwd: '/workspace',
        env: {},
        timeoutMs: 60_000,
        maxOutputBytes: 16_384,
        executionId: randomUUID(),
      });
      if (cleanedIntegrity.exitCode !== 0 || cleanedIntegrity.stdout.trim() !== 'ok')
        throw new Error('Production snapshot database integrity check failed after cleanup');
      const schema = await daemon.exec({
        command: 'php',
        args: [
          '-r',
          '$schemas=[]; foreach (array_slice($argv,1) as $file) { $db=new SQLite3($file, SQLITE3_OPEN_READONLY); $rows=$db->query("SELECT type,name,coalesce(sql,\'\') FROM sqlite_master WHERE name NOT LIKE \'sqlite_%\' ORDER BY type,name"); $parts=[]; while ($row=$rows->fetchArray(SQLITE3_NUM)) $parts[]=implode("\\0", $row); $schemas[]=hash("sha256", implode("\\n", $parts)); $db->close(); } echo implode(" ", $schemas);',
          '/workspace/data/pbootcms.db',
          `/workspace/.cloudcrane/production-refresh-${input.refreshId}/incoming/pbootcms.db`,
        ],
        cwd: '/workspace',
        env: {},
        timeoutMs: 30_000,
        maxOutputBytes: 4096,
        executionId: randomUUID(),
      });
      const schemaHashes = schema.stdout.trim().split(/\s+/);
      if (
        schema.exitCode !== 0 ||
        schemaHashes.length !== 2 ||
        !/^[0-9a-f]{64}$/.test(schemaHashes[0] ?? '') ||
        !/^[0-9a-f]{64}$/.test(schemaHashes[1] ?? '')
      )
        throw new Error('Workspace database schema compatibility check failed');
      if (schemaHashes[0] !== schemaHashes[1])
        throw new ProductionOperationError(
          'WORKSPACE_SCHEMA_MISMATCH',
          'Production and Workspace use different database schemas; synchronize or migrate the code before refreshing content',
        );
    } catch (error) {
      await this.runProductionRefreshFilesystemHelper(
        workspaceId,
        input.refreshId,
        `rm -rf "/workspace/.cloudcrane/production-refresh-${input.refreshId}"`,
      ).catch(() => undefined);
      if (wasRunning) await this.start(workspaceId).catch(() => undefined);
      else await this.stop(workspaceId).catch(() => undefined);
      throw error;
    }

    await this.stop(workspaceId);
    const backupState = {
      refreshId: input.refreshId,
      wasRunning,
      hadDatabase: await this.exists(databasePath),
      hadUploads: await this.exists(uploadsPath),
      sidecars: [] as string[],
    };
    try {
      if (backupState.hadDatabase) {
        const info = await lstat(databasePath);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error('Workspace database is not a regular file');
      }
      if (backupState.hadUploads) {
        const info = await lstat(uploadsPath);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error('Workspace uploads are not a regular directory');
        await this.assertTreeHasNoSymlinks(uploadsPath);
      }
      for (const suffix of ['-wal', '-shm', '-journal']) {
        const sidecar = `${databasePath}${suffix}`;
        if (await this.exists(sidecar)) {
          const info = await lstat(sidecar);
          if (!info.isFile() || info.isSymbolicLink())
            throw new Error('Workspace SQLite sidecar is not a regular file');
          backupState.sidecars.push(suffix);
        }
      }
      const backupCommands = [
        `refresh_root="/workspace/.cloudcrane/production-refresh-${input.refreshId}"`,
        'backup_root="$refresh_root/backup"',
        'mkdir -p "$backup_root"',
        ...(backupState.hadDatabase
          ? ['cp -a /workspace/data/pbootcms.db "$backup_root/pbootcms.db"']
          : []),
        ...(backupState.hadUploads ? ['cp -a /workspace/static/upload "$backup_root/upload"'] : []),
        ...backupState.sidecars.map(
          (suffix) =>
            `cp -a "/workspace/data/pbootcms.db${suffix}" "$backup_root/pbootcms.db${suffix}"`,
        ),
        'printf \'%s\' "$CLOUDCRANE_REFRESH_STATE" > /workspace/.cloudcrane/production-refresh-pending.tmp',
        'chmod 0644 /workspace/.cloudcrane/production-refresh-pending.tmp',
        'mv /workspace/.cloudcrane/production-refresh-pending.tmp /workspace/.cloudcrane/production-refresh-pending',
      ].join('\n');
      await this.runProductionRefreshFilesystemHelper(
        workspaceId,
        input.refreshId,
        backupCommands,
        undefined,
        { CLOUDCRANE_REFRESH_STATE: JSON.stringify(backupState) },
      );
      const swapCommands = [
        `refresh_root="/workspace/.cloudcrane/production-refresh-${input.refreshId}"`,
        'rm -f /workspace/data/pbootcms.db /workspace/data/pbootcms.db-wal /workspace/data/pbootcms.db-shm /workspace/data/pbootcms.db-journal',
        'rm -rf /workspace/static/upload',
        'mv "$refresh_root/incoming/pbootcms.db" /workspace/data/pbootcms.db',
        'mv "$refresh_root/incoming/upload" /workspace/static/upload',
        'chown -R 1000:1000 /workspace/data/pbootcms.db /workspace/static/upload',
      ].join('\n');
      await this.runProductionRefreshFilesystemHelper(workspaceId, input.refreshId, swapCommands);
      const preservePreviewAuthorization = [
        `refresh_root="/workspace/.cloudcrane/production-refresh-${input.refreshId}"`,
        'backup_db="$refresh_root/backup/pbootcms.db"',
        "auth_names=\"'sn', 'sn_user', 'licensecode'\"",
        'preview_auth_count=$(sqlite3 "$backup_db" "SELECT COUNT(*) FROM ay_config WHERE name IN ($auth_names);")',
        'production_auth_count=$(sqlite3 /workspace/data/pbootcms.db "SELECT COUNT(*) FROM ay_config WHERE name IN ($auth_names);")',
        'test "$preview_auth_count" = 3 || { echo "Workspace Preview authorization data is incomplete (count=$preview_auth_count)" >&2; exit 1; }',
        'test "$production_auth_count" = 3 || { echo "Production authorization data is incomplete (count=$production_auth_count)" >&2; exit 1; }',
        'sqlite3 /workspace/data/pbootcms.db "ATTACH DATABASE \'$backup_db\' AS workspace_before_refresh; BEGIN IMMEDIATE; UPDATE ay_config AS target SET value = (SELECT source.value FROM workspace_before_refresh.ay_config AS source WHERE source.name = target.name) WHERE target.name IN ($auth_names); COMMIT;"',
        'mkdir -p /workspace/runtime/config && find /workspace/runtime/config -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +',
      ].join('\n');
      await this.runProductionRefreshFilesystemHelper(
        workspaceId,
        input.refreshId,
        preservePreviewAuthorization,
      );
      await this.startWithoutRefreshRecovery(workspaceId);
      const restartedContainer = await this.container(workspaceId);
      const verificationEndpoint = await this.getEndpointByContainer(restartedContainer);
      const verificationDaemon = new WorkspaceDaemonClient(verificationEndpoint, 60_000);
      const verified = await verificationDaemon.exec({
        command: 'sqlite3',
        args: ['/workspace/data/pbootcms.db', 'PRAGMA integrity_check;'],
        cwd: '/workspace',
        env: {},
        timeoutMs: 60_000,
        maxOutputBytes: 16_384,
        executionId: randomUUID(),
      });
      if (verified.exitCode !== 0 || verified.stdout.trim() !== 'ok')
        throw new Error('Workspace database integrity check failed after Production refresh');
      const imported = await this.measureContentImport(databasePath, uploadsPath);
      await this.runProductionRefreshFilesystemHelper(
        workspaceId,
        input.refreshId,
        `rm -f /workspace/.cloudcrane/production-refresh-pending && rm -rf "/workspace/.cloudcrane/production-refresh-${input.refreshId}"`,
      );
      return imported;
    } catch (error) {
      if (await this.exists(pendingMarker)) {
        await this.rollbackProductionRefresh(workspaceId, input.refreshId, backupState);
      }
      await this.runProductionRefreshFilesystemHelper(
        workspaceId,
        input.refreshId,
        `rm -f /workspace/.cloudcrane/production-refresh-pending && rm -rf "/workspace/.cloudcrane/production-refresh-${input.refreshId}"`,
      ).catch(() => undefined);
      if (wasRunning) await this.start(workspaceId).catch(() => undefined);
      else await this.stop(workspaceId).catch(() => undefined);
      throw error;
    }
  }

  private async container(workspaceId: string): Promise<Docker.Container> {
    this.assertWorkspaceId(workspaceId);
    return this.docker.getContainer(`cloudcrane-workspace-${workspaceId}`);
  }

  private async recoverPendingProductionRefresh(workspaceId: string): Promise<void> {
    this.assertWorkspaceId(workspaceId);
    const workspaceRoot = this.persistentPath(workspaceId);
    const marker = path.join(workspaceRoot, '.cloudcrane', 'production-refresh-pending');
    let state: {
      refreshId: string;
      wasRunning: boolean;
      hadDatabase: boolean;
      hadUploads: boolean;
      sidecars: string[];
    };
    try {
      state = JSON.parse(await readFile(marker, 'utf8')) as typeof state;
    } catch (error) {
      if (this.isNotFound(error)) return;
      throw new Error('Production refresh recovery marker is invalid', { cause: error });
    }
    this.assertRefreshId(state.refreshId);
    if (
      typeof state.wasRunning !== 'boolean' ||
      typeof state.hadDatabase !== 'boolean' ||
      typeof state.hadUploads !== 'boolean' ||
      !Array.isArray(state.sidecars) ||
      state.sidecars.some((suffix) => !['-wal', '-shm', '-journal'].includes(suffix))
    )
      throw new Error('Production refresh recovery marker is invalid');

    const container = await this.container(workspaceId);
    const info = await container.inspect();
    if (info.State?.Running) await container.stop();
    await this.rollbackProductionRefresh(workspaceId, state.refreshId, state);
    await this.runProductionRefreshFilesystemHelper(
      workspaceId,
      state.refreshId,
      `rm -f /workspace/.cloudcrane/production-refresh-pending && rm -rf "/workspace/.cloudcrane/production-refresh-${state.refreshId}"`,
    );
    if (state.wasRunning) {
      const restored = await this.container(workspaceId);
      const restoredInfo = await restored.inspect();
      if (!restoredInfo.State?.Running) await restored.start();
      await this.waitForPreview(restored);
    }
  }

  private async rollbackProductionRefresh(
    workspaceId: string,
    refreshId: string,
    state: {
      hadDatabase: boolean;
      hadUploads: boolean;
      sidecars: string[];
    },
  ): Promise<void> {
    const commands = [
      `backup_root="/workspace/.cloudcrane/production-refresh-${refreshId}/backup"`,
      'rm -f /workspace/data/pbootcms.db /workspace/data/pbootcms.db-wal /workspace/data/pbootcms.db-shm /workspace/data/pbootcms.db-journal',
      'rm -rf /workspace/static/upload',
      ...(state.hadDatabase
        ? [
            'mkdir -p /workspace/data',
            'cp -a "$backup_root/pbootcms.db" /workspace/data/pbootcms.db',
          ]
        : []),
      ...(state.hadUploads
        ? ['mkdir -p /workspace/static', 'cp -a "$backup_root/upload" /workspace/static/upload']
        : []),
      ...state.sidecars.map(
        (suffix) =>
          `cp -a "$backup_root/pbootcms.db${suffix}" "/workspace/data/pbootcms.db${suffix}"`,
      ),
      ...(state.hadDatabase ? ['chown -R 1000:1000 /workspace/data/pbootcms.db'] : []),
      ...(state.hadUploads ? ['chown -R 1000:1000 /workspace/static/upload'] : []),
    ].join('\n');
    await this.runProductionRefreshFilesystemHelper(workspaceId, refreshId, commands);
  }

  private async runProductionRefreshFilesystemHelper(
    workspaceId: string,
    refreshId: string,
    script: string,
    snapshotDirectory?: string,
    environment: Record<string, string> = {},
  ): Promise<void> {
    this.assertWorkspaceId(workspaceId);
    this.assertRefreshId(refreshId);
    const workspaceRoot = this.persistentPath(workspaceId);
    const binds = [`${workspaceRoot}:/workspace`];
    if (snapshotDirectory) binds.push(`${snapshotDirectory}:/production-snapshot:ro`);
    const container = await this.docker.createContainer({
      Image: this.config.workspaceImage,
      name: `cloudcrane-workspace-refresh-${workspaceId}-${randomUUID()}`,
      User: '0:0',
      Entrypoint: ['/bin/sh'],
      Cmd: ['-ec', script],
      Env: Object.entries(environment).map(([key, value]) => `${key}=${value}`),
      HostConfig: {
        Binds: binds,
        NetworkMode: 'none',
        AutoRemove: false,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '2m', 'max-file': '2' } },
      },
    });
    try {
      const output = await container.attach({ stream: true, stdout: true, stderr: true });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
        if (chunks.reduce((size, item) => size + item.length, 0) < 4096) chunks.push(chunk);
      };
      stdout.on('data', collect(stdoutChunks));
      stderr.on('data', collect(stderrChunks));
      const outputClosed = new Promise<void>((resolve, reject) => {
        output.once('end', resolve);
        output.once('close', resolve);
        output.once('error', reject);
      });
      this.docker.modem.demuxStream(output, stdout, stderr);
      await container.start();
      const result = await container.wait();
      await outputClosed;
      if (result.StatusCode !== 0) {
        const details = Buffer.concat([...stdoutChunks, ...stderrChunks])
          .toString('utf8')
          .split('')
          .filter((character) => {
            const code = character.charCodeAt(0);
            return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
          })
          .join('')
          .slice(-4096)
          .trim();
        throw new Error(
          details
            ? `Workspace Production refresh filesystem operation failed: ${details}`
            : 'Workspace Production refresh filesystem operation failed',
        );
      }
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  private async startWithoutRefreshRecovery(workspaceId: string): Promise<void> {
    const container = await this.ensureRuntimeCompatible(workspaceId);
    const info = await container.inspect();
    if (!info.State?.Running) await container.start();
    await this.waitForPreview(container);
  }

  private async assertTreeHasNoSymlinks(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Production snapshot contains a symbolic link');
      if (entry.isDirectory()) await this.assertTreeHasNoSymlinks(path.join(directory, entry.name));
      else if (!entry.isFile())
        throw new Error('Production snapshot contains an unsupported entry');
    }
  }

  private async measureContentImport(
    databasePath: string,
    uploadsPath: string,
  ): Promise<ProductionContentImportResult> {
    let uploadFiles = 0;
    let uploadBytes = 0;
    const measure = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await measure(filename);
        else if (entry.isFile()) {
          uploadFiles += 1;
          uploadBytes += (await lstat(filename)).size;
        } else throw new Error('Workspace uploads contain an unsupported entry');
      }
    };
    await measure(uploadsPath);
    return {
      databaseBytes: (await lstat(databasePath)).size,
      uploadFiles,
      uploadBytes,
    };
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

  private assertRefreshId(refreshId: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(refreshId)
    )
      throw new Error('Invalid production refresh id');
  }

  private async ensureRuntimeCompatible(workspaceId: string): Promise<Docker.Container> {
    const existing = this.reconciliationLocks.get(workspaceId);
    if (existing) return existing;
    const reconciliation = this.reconcileRuntime(workspaceId).finally(() => {
      this.reconciliationLocks.delete(workspaceId);
    });
    this.reconciliationLocks.set(workspaceId, reconciliation);
    return reconciliation;
  }

  private async reconcileRuntime(workspaceId: string): Promise<Docker.Container> {
    const persistentPath = this.persistentPath(workspaceId);
    await mkdir(persistentPath, { recursive: true });
    await this.quotaManager?.ensure(workspaceId, persistentPath);
    const container = await this.container(workspaceId);
    const info = await container.inspect();
    const referencePath = await this.referencePath(workspaceId);
    if (this.matchesRuntimeSpec(workspaceId, info, referencePath)) return container;

    const networkMode = info.HostConfig?.NetworkMode;
    const network = networkMode ? this.docker.getNetwork(networkMode) : undefined;
    if (network) {
      const networkInfo = await network.inspect();
      if (networkInfo.Name !== `cloudcrane-workspace-${workspaceId}`) {
        throw new Error('Cannot reconcile runtime with an unmanaged Docker network');
      }
    }
    if (info.State?.Running) await container.stop();
    await container.remove({ force: true });
    await network?.remove();
    this.reconcilingWorkspaces.add(workspaceId);
    try {
      const runtime = await this.create(workspaceId);
      return this.container(runtime.workspaceId);
    } finally {
      this.reconcilingWorkspaces.delete(workspaceId);
    }
  }

  private matchesRuntimeSpec(
    workspaceId: string,
    info: Docker.ContainerInspectInfo,
    referencePath: string | undefined,
  ): boolean {
    const mounts = info.Mounts ?? [];
    const workspaceMount = mounts.find((mount) => mount.Destination === '/workspace');
    const referenceMount = mounts.find(
      (mount) => mount.Destination === '/workspace/.cloudcrane/references',
    );
    const persistentPath = this.persistentPath(workspaceId);
    const workspaceIsCompatible =
      workspaceMount?.Source === persistentPath && workspaceMount.RW === true;
    const referenceIsCompatible = referencePath
      ? referenceMount?.Source === referencePath && referenceMount.RW === false
      : !referenceMount;
    return (
      info.Config?.Image === this.config.workspaceImage &&
      workspaceIsCompatible &&
      referenceIsCompatible &&
      info.HostConfig?.Privileged === false &&
      info.HostConfig?.PidMode === '' &&
      info.HostConfig?.IpcMode === 'private' &&
      info.HostConfig?.SecurityOpt?.includes('no-new-privileges:true') === true
    );
  }
  private async runtime(
    workspaceId: string,
    containerRef: string,
    status: WorkspaceRuntime['status'],
  ): Promise<WorkspaceRuntime> {
    return {
      workspaceId,
      containerRef,
      workspacePath: this.persistentPath(workspaceId),
      status,
      endpoint: await this.getEndpoint(workspaceId),
      previewPort: await this.getPreviewPort(workspaceId),
    };
  }

  private async waitForPreview(container: Docker.Container): Promise<void> {
    const endpoint = await this.getEndpointByContainer(container);
    const client = new WorkspaceDaemonClient(endpoint, 2_000);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const info = await client.runtimeInfo();
        if (info.preview.status === 'ready') return;
      } catch {
        /* daemon or preview is still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('workspace preview runtime did not become ready');
  }

  private async getEndpointByContainer(container: Docker.Container): Promise<string> {
    const info = await container.inspect();
    const binding = info.NetworkSettings?.Ports?.['7070/tcp']?.[0];
    if (!binding?.HostPort) throw new Error('Workspace daemon endpoint is unavailable');
    return `http://127.0.0.1:${binding.HostPort}`;
  }

  private async getPreviewPort(workspaceId: string): Promise<number | undefined> {
    const container = await this.container(workspaceId);
    const info = await container.inspect();
    const binding = info.NetworkSettings?.Ports?.['8080/tcp']?.[0];
    return binding?.HostPort ? Number(binding.HostPort) : undefined;
  }
  private persistentPath(workspaceId: string): string {
    return `${this.config.workspaceRoot}/${workspaceId}/workspace`;
  }
  private async referencePath(workspaceId: string): Promise<string | undefined> {
    if (!this.config.referenceRoot) return undefined;
    const referencePath = `${this.config.referenceRoot}/${workspaceId}`;
    try {
      const info = await lstat(referencePath);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('workspace reference must be a real directory');
      return referencePath;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        await mkdir(referencePath, { recursive: true });
        return referencePath;
      }
      throw error;
    }
  }
  private async provisionWorkspaceOwnership(
    persistentPath: string,
    workspaceId: string,
  ): Promise<void> {
    const ownerContainer = await this.docker.createContainer({
      Image: this.config.workspaceImage,
      name: `cloudcrane-workspace-owner-${workspaceId}-${randomUUID()}`,
      User: '0:0',
      Entrypoint: ['/usr/bin/chown'],
      Cmd: ['-R', '1000:1000', '/workspace'],
      HostConfig: {
        Binds: [`${persistentPath}:/workspace`],
        NetworkMode: 'none',
        AutoRemove: false,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '2m', 'max-file': '2' } },
      },
    });
    try {
      await ownerContainer.start();
      const result = await ownerContainer.wait();
      if (result.StatusCode !== 0) {
        throw new Error(`Workspace ownership provisioning failed (${result.StatusCode})`);
      }
    } finally {
      await ownerContainer.remove({ force: true }).catch(() => undefined);
    }
  }

  private async restoreHostOwnership(persistentPath: string): Promise<void> {
    const parent = await lstat(path.dirname(persistentPath));
    const uid = parent.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0);
    const gid = parent.gid ?? (typeof process.getgid === 'function' ? process.getgid() : 0);
    const ownerContainer = await this.docker.createContainer({
      Image: this.config.workspaceImage,
      name: `cloudcrane-workspace-restore-${randomUUID()}`,
      User: '0:0',
      Entrypoint: ['/usr/bin/chown'],
      Cmd: ['-R', `${uid}:${gid}`, '/workspace'],
      HostConfig: {
        Binds: [`${persistentPath}:/workspace`],
        NetworkMode: 'none',
        AutoRemove: false,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '2m', 'max-file': '2' } },
      },
    });
    try {
      await ownerContainer.start();
      const result = await ownerContainer.wait();
      if (result.StatusCode !== 0)
        throw new Error(`Workspace host ownership restore failed (${result.StatusCode})`);
    } finally {
      await ownerContainer.remove({ force: true }).catch(() => undefined);
    }
  }
  private async removeWorkspaceFiles(workspaceId: string): Promise<void> {
    const persistentPath = this.persistentPath(workspaceId);
    try {
      await lstat(persistentPath);
      await this.restoreHostOwnership(persistentPath);
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
    await rm(path.dirname(persistentPath), { recursive: true, force: true });
    if (this.config.referenceRoot)
      await rm(`${this.config.referenceRoot}/${workspaceId}`, { recursive: true, force: true });
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
  private assertWorkspaceId(workspaceId: string): void {
    if (!z.string().uuid().safeParse(workspaceId).success)
      throw new Error('Invalid internal workspace id');
  }
}
