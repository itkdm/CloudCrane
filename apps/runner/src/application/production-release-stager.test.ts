import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractProductionReleaseArchive } from '@cloudcrane/pboot-snapshot';
import type { ProcessExecRequest, ProcessExecResponse } from '@cloudcrane/workspace-protocol';
import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from '../config.js';
import type { WorkspaceDaemonClient } from '../infrastructure/daemon/workspace-daemon-client.js';
import type { WorkspaceRuntimeService } from './workspace-runtime-service.js';
import { ProductionReleaseStager } from './production-release-stager.js';

const websiteId = 'f9f454c2-3fa8-48da-a869-182584c10a6b';
const workspaceId = '00000000-0000-4000-8000-000000000074';
const releaseId = 'ded2a9d3-b4bd-4df9-9162-95b1a7b3ac53';
const coreCommit = '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea';

describe('ProductionReleaseStager', () => {
  it('checks SQLite and archives an online backup, then removes the temporary snapshot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-release-stager-'));
    const workspaceRoot = path.join(root, 'workspaces', workspaceId, 'workspace');
    const managedBaseRoot = path.join(root, 'managed-pboot');
    const releaseArtifactRoot = path.join(root, 'artifacts');
    const stagingPrefix = path.join(workspaceRoot, '.cloudcrane', 'publish-staging');
    await mkdir(path.join(workspaceRoot, 'apps'), { recursive: true });
    await mkdir(path.join(workspaceRoot, 'config'), { recursive: true });
    await mkdir(path.join(workspaceRoot, 'data'), { recursive: true });
    await mkdir(path.join(managedBaseRoot, 'apps'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'apps', 'core.php'), '<?php // managed core');
    await writeFile(path.join(workspaceRoot, 'config', 'config.php'), '<?php return [];');
    await writeFile(path.join(workspaceRoot, 'data', 'pbootcms.db'), 'live workspace database');
    await writeFile(path.join(managedBaseRoot, 'apps', 'core.php'), '<?php // managed core');
    await writeFile(
      path.join(managedBaseRoot, '.cloudcrane-base'),
      `pbootcms=3.2.26\nsourceCommit=${coreCommit}\n`,
    );

    const daemon = {
      mkdir: async ({ path: virtualPath }: { path: string }) => {
        await mkdir(path.join(workspaceRoot, virtualPath.slice('/workspace/'.length)), {
          recursive: true,
        });
        return { path: virtualPath, created: true };
      },
      exec: async (request: ProcessExecRequest): Promise<ProcessExecResponse> => {
        const command = String(request.args[1] ?? '');
        if (command === 'PRAGMA integrity_check;')
          return processResult(request.executionId ?? releaseId, 'ok\n');
        if (command.startsWith('.backup ')) {
          const virtualPath = command.slice(".backup '".length, -1);
          const snapshotPath = path.join(workspaceRoot, virtualPath.slice('/workspace/'.length));
          await mkdir(path.dirname(snapshotPath), { recursive: true });
          await writeFile(snapshotPath, 'consistent SQLite online backup');
          return processResult(request.executionId ?? releaseId, '');
        }
        throw new Error(`unexpected daemon command: ${request.command}`);
      },
    } as unknown as Pick<WorkspaceDaemonClient, 'exec' | 'mkdir'>;
    const runtime = {
      endpoint: async () => 'http://workspace-daemon.test',
    } as unknown as WorkspaceRuntimeService;
    const config = loadRunnerConfig({
      WORKSPACE_ROOT: path.join(root, 'workspaces'),
      WORKSPACE_MANAGED_PBOOT_BASE_ROOT: managedBaseRoot,
      RELEASE_ARTIFACT_ROOT: releaseArtifactRoot,
    });
    const stager = new ProductionReleaseStager(runtime, config, () => daemon);

    try {
      const result = await stager.stage(websiteId, workspaceId, {
        artifactStorageKey: `release-${releaseId}.zip`,
        releaseId,
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: coreCommit,
        firstPublish: true,
      });
      const extractedRoot = path.join(root, 'extracted');
      const manifest = await extractProductionReleaseArchive({
        archivePath: path.join(releaseArtifactRoot, result.artifactStorageKey),
        expectedSha256: result.artifactSha256,
        expectedWebsiteId: websiteId,
        expectedReleaseId: releaseId,
        destination: extractedRoot,
      });

      expect(await readFile(path.join(extractedRoot, 'data', 'pbootcms.db'), 'utf8')).toBe(
        'consistent SQLite online backup',
      );
      expect(manifest).toMatchObject({
        firstPublish: true,
        sourceGitHead: null,
        sourceGitDirty: true,
      });
      expect(await readFile(path.join(workspaceRoot, 'data', 'pbootcms.db'), 'utf8')).toBe(
        'live workspace database',
      );
      expect(await readdir(stagingPrefix)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function processResult(executionId: string, stdout: string): ProcessExecResponse {
  return {
    executionId,
    stdout,
    stderr: '',
    exitCode: 0,
    durationMs: 1,
    truncated: false,
    status: 'completed',
  };
}
