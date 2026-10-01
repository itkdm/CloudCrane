import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildProductionReleaseArchive,
  collectProductionReleaseInventory,
  extractProductionReleaseArchive,
} from '@cloudcrane/pboot-snapshot';
import type { ProductionOperation } from '@cloudcrane/workspace-protocol';
import { WorkspaceDaemonClient } from '../infrastructure/daemon/workspace-daemon-client.js';
import type { RunnerConfig } from '../config.js';
import { ProductionOperationError } from '../ports/production-operation-error.js';
import type { WorkspaceRuntimeService } from './workspace-runtime-service.js';

type ReleaseStageInput = Extract<ProductionOperation, { operation: 'release.stage' }>['payload'];
type ReleaseStageDaemon = Pick<WorkspaceDaemonClient, 'exec' | 'mkdir'>;

export class ProductionReleaseStager {
  constructor(
    private readonly runtime: WorkspaceRuntimeService,
    private readonly config: RunnerConfig,
    private readonly daemonFactory: (endpoint: string, timeoutMs: number) => ReleaseStageDaemon = (
      endpoint,
      timeoutMs,
    ) => new WorkspaceDaemonClient(endpoint, timeoutMs),
  ) {}

  async stage(websiteId: string, workspaceId: string, input: ReleaseStageInput) {
    const artifactRoot = path.resolve(this.config.releaseArtifactRoot);
    const workspaceRoot = path.resolve(this.config.workspaceRoot, workspaceId, 'workspace');
    const managedBaseRoot = this.config.managedPbootBaseRoot;
    if (!managedBaseRoot) throw new Error('managed Pboot base path is not configured');
    const outputPath = path.resolve(artifactRoot, input.artifactStorageKey);
    if (!outputPath.startsWith(`${artifactRoot}${path.sep}`))
      throw new Error('production release artifact path is outside its root');

    const existing = await lstat(outputPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (existing) return this.reuseExistingArtifact(outputPath, artifactRoot, websiteId, input);

    const daemon = this.daemonFactory(await this.runtime.endpoint(workspaceId), 122_000);
    const sourceBefore = await this.captureSourceState(daemon, workspaceRoot, input.firstPublish);
    await this.assertDiffClean(daemon, sourceBefore.hasGitRepository);

    const stagingId = randomUUID();
    const stagingRelativePath = `.cloudcrane/publish-staging/${stagingId}`;
    const stagingVirtualPath = `/workspace/${stagingRelativePath}`;
    const stagingHostPath = path.join(workspaceRoot, ...stagingRelativePath.split('/'));
    let artifactCreated = false;
    try {
      let initialDatabaseSnapshotPath: string | undefined;
      if (input.firstPublish) {
        await daemon.mkdir({ path: stagingVirtualPath, recursive: true });
        const databasePath = '/workspace/data/pbootcms.db';
        const integrity = await daemon.exec(
          {
            command: 'sqlite3',
            args: [databasePath, 'PRAGMA integrity_check;'],
            cwd: '/workspace',
            env: {},
            timeoutMs: 60_000,
            maxOutputBytes: 16_384,
            executionId: randomUUID(),
          },
          62_000,
        );
        if (integrity.exitCode !== 0 || integrity.stdout.trim() !== 'ok')
          throw new Error('source Pboot database integrity check failed');

        const snapshotVirtualPath = `${stagingVirtualPath}/pbootcms.db`;
        const backup = await daemon.exec(
          {
            command: 'sqlite3',
            args: [databasePath, `.backup '${snapshotVirtualPath}'`],
            cwd: '/workspace',
            env: {},
            timeoutMs: 60_000,
            maxOutputBytes: 16_384,
            executionId: randomUUID(),
          },
          62_000,
        );
        if (backup.exitCode !== 0) throw new Error('source Pboot database backup failed');

        const backupIntegrity = await daemon.exec(
          {
            command: 'sqlite3',
            args: [snapshotVirtualPath, 'PRAGMA integrity_check;'],
            cwd: '/workspace',
            env: {},
            timeoutMs: 60_000,
            maxOutputBytes: 16_384,
            executionId: randomUUID(),
          },
          62_000,
        );
        if (backupIntegrity.exitCode !== 0 || backupIntegrity.stdout.trim() !== 'ok')
          throw new Error('Pboot database backup integrity check failed');
        initialDatabaseSnapshotPath = path.join(stagingHostPath, 'pbootcms.db');
      }

      const result = await buildProductionReleaseArchive({
        workspaceRoot,
        managedBaseRoot,
        sourceWebsiteId: websiteId,
        sourcePbootVersion: input.sourcePbootVersion,
        sourceCoreCommit: input.sourceCoreCommit,
        sourceGitHead: sourceBefore.gitHead,
        sourceGitDirty: sourceBefore.gitDirty,
        firstPublish: input.firstPublish,
        initialDatabaseSnapshotPath,
        releaseId: input.releaseId,
        outputPath,
      });
      artifactCreated = true;
      await this.writeArtifactMetadata(outputPath, {
        websiteId,
        releaseId: input.releaseId,
        createdAt: result.manifest.createdAt,
      });

      const sourceAfter = await this.captureSourceState(daemon, workspaceRoot, input.firstPublish);
      await this.assertDiffClean(daemon, sourceAfter.hasGitRepository);
      if (
        sourceBefore.gitHead !== sourceAfter.gitHead ||
        sourceBefore.gitStatus !== sourceAfter.gitStatus ||
        JSON.stringify(sourceBefore.inventory) !== JSON.stringify(sourceAfter.inventory)
      ) {
        await rm(outputPath, { force: true });
        artifactCreated = false;
        throw new ProductionOperationError(
          'WORKSPACE_CHANGED_DURING_PUBLISH',
          'Workspace changed while the release was being staged',
        );
      }

      return {
        artifactStorageKey: input.artifactStorageKey,
        artifactSha256: result.sha256,
        artifactSize: result.size,
        manifest: result.manifest,
      };
    } catch (error) {
      if (artifactCreated) {
        await rm(outputPath, { force: true }).catch(() => undefined);
        await rm(`${outputPath}.meta.json`, { force: true }).catch(() => undefined);
      }
      throw error;
    } finally {
      await daemon.exec(
        {
          command: 'rm',
          args: ['-rf', '--', stagingVirtualPath],
          cwd: '/workspace',
          env: {},
          timeoutMs: 30_000,
          maxOutputBytes: 1_024,
          executionId: randomUUID(),
        },
        32_000,
      );
    }
  }

  private async reuseExistingArtifact(
    outputPath: string,
    artifactRoot: string,
    websiteId: string,
    input: ReleaseStageInput,
  ) {
    const info = await lstat(outputPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 500 * 1024 * 1024)
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'An invalid artifact already exists for this release',
      );
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(outputPath)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    const verificationDirectory = path.join(
      artifactRoot,
      `.verify-${input.releaseId}-${randomUUID()}`,
    );
    let manifest: Awaited<ReturnType<typeof extractProductionReleaseArchive>>;
    try {
      manifest = await extractProductionReleaseArchive({
        archivePath: outputPath,
        expectedSha256: sha256,
        expectedWebsiteId: websiteId,
        expectedReleaseId: input.releaseId,
        destination: verificationDirectory,
      });
    } catch {
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'The existing release artifact failed identity or integrity verification',
      );
    } finally {
      await rm(verificationDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    if (
      manifest.sourcePbootVersion !== input.sourcePbootVersion ||
      manifest.sourceCoreCommit !== input.sourceCoreCommit ||
      manifest.firstPublish !== input.firstPublish
    )
      throw new ProductionOperationError(
        'PRODUCTION_STATE_CONFLICT',
        'The existing release artifact does not match the requested release metadata',
      );

    const metadata = {
      websiteId,
      releaseId: input.releaseId,
      createdAt: manifest.createdAt,
    };
    const metadataPath = `${outputPath}.meta.json`;
    const existingMetadata = await readFile(metadataPath, 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      },
    );
    if (existingMetadata) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(existingMetadata);
      } catch {
        throw new ProductionOperationError(
          'PRODUCTION_STATE_CONFLICT',
          'The existing release artifact metadata is invalid',
        );
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as Record<string, unknown>).websiteId !== websiteId ||
        (parsed as Record<string, unknown>).releaseId !== input.releaseId
      )
        throw new ProductionOperationError(
          'PRODUCTION_STATE_CONFLICT',
          'The existing release artifact belongs to different release metadata',
        );
    } else {
      await this.writeArtifactMetadata(outputPath, metadata);
    }
    return {
      artifactStorageKey: input.artifactStorageKey,
      artifactSha256: sha256,
      artifactSize: info.size,
      manifest,
    };
  }

  private async writeArtifactMetadata(
    outputPath: string,
    metadata: { websiteId: string; releaseId: string; createdAt: string },
  ): Promise<void> {
    const filename = `${outputPath}.meta.json`;
    try {
      await writeFile(filename, JSON.stringify(metadata), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o440,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>;
      if (current.websiteId !== metadata.websiteId || current.releaseId !== metadata.releaseId)
        throw new ProductionOperationError(
          'PRODUCTION_STATE_CONFLICT',
          'Release artifact metadata conflicts with another website',
        );
    }
  }

  private async captureSourceState(
    daemon: ReleaseStageDaemon,
    workspaceRoot: string,
    firstPublish: boolean,
  ) {
    const inventory = await collectProductionReleaseInventory(workspaceRoot, firstPublish);
    const gitPath = path.join(workspaceRoot, '.git');
    const gitInfo = await lstat(gitPath).catch(() => undefined);
    const hasGitRepository = Boolean(gitInfo?.isFile() || gitInfo?.isDirectory());
    if (!hasGitRepository) {
      return {
        inventory,
        gitHead: null,
        gitDirty: true,
        gitStatus: 'no-git-repository',
        hasGitRepository,
      };
    }

    const head = await daemon.exec(
      {
        command: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: '/workspace',
        env: {},
        timeoutMs: 10_000,
        maxOutputBytes: 1_024,
        executionId: randomUUID(),
      },
      12_000,
    );
    const status = await daemon.exec(
      {
        command: 'git',
        args: [
          'status',
          '--porcelain=v1',
          '--untracked-files=all',
          '--',
          '.',
          ':(exclude).cloudcrane/publish-staging/**',
        ],
        cwd: '/workspace',
        env: {},
        timeoutMs: 10_000,
        maxOutputBytes: 4 * 1024 * 1024,
        executionId: randomUUID(),
      },
      12_000,
    );
    if (head.exitCode !== 0 || status.exitCode !== 0 || status.truncated)
      throw new Error('WORKSPACE_SOURCE_STATE_UNAVAILABLE');
    const gitHead = head.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(gitHead)) throw new Error('WORKSPACE_SOURCE_STATE_UNAVAILABLE');
    return {
      inventory,
      gitHead,
      gitDirty: status.stdout.length > 0,
      gitStatus: status.stdout,
      hasGitRepository,
    };
  }

  private async assertDiffClean(daemon: ReleaseStageDaemon, hasGitRepository: boolean) {
    if (!hasGitRepository) return;
    for (const args of [
      ['diff', '--check'],
      ['diff', '--cached', '--check'],
    ]) {
      const result = await daemon.exec(
        {
          command: 'git',
          args,
          cwd: '/workspace',
          env: {},
          timeoutMs: 10_000,
          maxOutputBytes: 16_384,
          executionId: randomUUID(),
        },
        12_000,
      );
      if (result.exitCode !== 0) throw new Error('WORKSPACE_DIFF_CHECK_FAILED');
    }
  }
}
