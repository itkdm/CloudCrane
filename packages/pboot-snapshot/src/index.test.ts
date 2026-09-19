import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  assertSnapshotCanRestore,
  buildSnapshotArchive,
  buildSnapshotManifest,
  classifySnapshotPath,
  collectSiteStateInventory,
  compareVersions,
  detectCoreDrift,
  parseSnapshotManifest,
} from './index.js';
import { planPbootMigrations } from './pboot-migrations.js';

describe('Pboot snapshot boundaries', () => {
  it('classifies managed core, site state, and runtime paths', () => {
    expect(classifySnapshotPath('apps/common/version.php')).toBe('MANAGED_CORE');
    expect(classifySnapshotPath('template/default/index.html')).toBe('SITE_STATE');
    expect(classifySnapshotPath('static/upload/logo.png')).toBe('SITE_STATE');
    expect(classifySnapshotPath('data/pbootcms.db')).toBe('SITE_STATE');
    expect(classifySnapshotPath('runtime/cache/config.php')).toBe('EPHEMERAL_RUNTIME');
    expect(classifySnapshotPath('.cloudcrane/references/ref-a/file.txt')).toBe('EPHEMERAL_RUNTIME');
  });

  it('rejects traversal paths', () => {
    expect(() => classifySnapshotPath('../apps/index.php')).toThrow(
      'invalid workspace relative path',
    );
    expect(() => classifySnapshotPath('apps/../template/index.html')).toThrow(
      'invalid workspace relative path',
    );
  });

  it('detects core modifications, additions, deletions, and symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-snapshot-'));
    const base = path.join(root, 'base');
    const workspace = path.join(root, 'workspace');
    await mkdir(path.join(base, 'apps'), { recursive: true });
    await mkdir(path.join(workspace, 'apps'), { recursive: true });
    await writeFile(path.join(base, 'apps', 'common.php'), 'base');
    await writeFile(path.join(workspace, 'apps', 'common.php'), 'changed');
    await writeFile(path.join(workspace, 'apps', 'added.php'), 'added');
    await writeFile(path.join(base, 'apps', 'deleted.php'), 'deleted');
    await symlink('common.php', path.join(workspace, 'apps', 'link.php'));
    const report = await detectCoreDrift({ workspaceRoot: workspace, managedBaseRoot: base });
    expect(report.hasDrift).toBe(true);
    expect(report.entries).toEqual([
      { path: 'apps/added.php', kind: 'added' },
      { path: 'apps/common.php', kind: 'modified' },
      { path: 'apps/deleted.php', kind: 'deleted' },
      { path: 'apps/link.php', kind: 'symlink' },
    ]);
  });

  it('collects site state without runtime or managed core files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-snapshot-state-'));
    await mkdir(path.join(root, 'apps'), { recursive: true });
    await mkdir(path.join(root, 'config'), { recursive: true });
    await mkdir(path.join(root, 'rewrite'), { recursive: true });
    await mkdir(path.join(root, 'template', 'default'), { recursive: true });
    await mkdir(path.join(root, 'runtime', 'cache'), { recursive: true });
    await writeFile(path.join(root, 'apps', 'index.php'), 'managed');
    await writeFile(path.join(root, 'config', 'config.php'), 'managed');
    await writeFile(path.join(root, 'rewrite', 'index.html'), 'managed');
    await writeFile(path.join(root, 'template', 'default', 'index.html'), 'site');
    await writeFile(path.join(root, 'runtime', 'cache', 'ignored.txt'), 'runtime');
    const files = await collectSiteStateInventory(root);
    expect(files.map((file) => file.path)).toEqual(['template/default/index.html']);
    expect(
      buildSnapshotManifest({
        sourceWebsiteId: 'website-1',
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea',
        dbSchemaVersion: '3.2.26',
        files,
      }).files,
    ).toMatchObject({ count: 1, bytes: 4, entries: files });
  });

  it('builds an immutable manifest plus payload archive and excludes managed/runtime files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-snapshot-archive-'));
    const base = path.join(root, 'base');
    const workspace = path.join(root, 'workspace');
    const output = path.join(root, 'artifacts', 'snapshot.zip');
    for (const directory of [base, workspace]) {
      await mkdir(path.join(directory, 'apps'), { recursive: true });
      await mkdir(path.join(directory, 'config'), { recursive: true });
    }
    await writeFile(path.join(base, 'apps', 'core.php'), 'managed');
    await writeFile(path.join(workspace, 'apps', 'core.php'), 'managed');
    await writeFile(path.join(base, 'config', 'config.php'), 'managed');
    await writeFile(path.join(workspace, 'config', 'config.php'), 'managed');
    await writeFile(
      path.join(base, '.cloudcrane-base'),
      'pbootcms=3.2.26\nsourceCommit=8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea\n',
    );
    await mkdir(path.join(workspace, 'template', 'default'), { recursive: true });
    await mkdir(path.join(workspace, 'runtime'), { recursive: true });
    await writeFile(path.join(workspace, 'template', 'default', 'index.html'), 'hello');
    await writeFile(path.join(workspace, 'runtime', 'cache.json'), 'discard');

    const result = await buildSnapshotArchive({
      workspaceRoot: workspace,
      managedBaseRoot: base,
      sourceWebsiteId: 'website-1',
      sourcePbootVersion: '3.2.26',
      sourceCoreCommit: '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea',
      dbSchemaVersion: '3.2.26',
      outputPath: output,
    });
    const archive = await readFile(output);
    const entries = unzipSync(archive);
    expect(Object.keys(entries).sort()).toEqual([
      'manifest.json',
      'payload/template/default/index.html',
    ]);
    expect(JSON.parse(new TextDecoder().decode(entries['manifest.json']))).toMatchObject({
      artifactType: 'cloudcrane-pboot-site-snapshot',
      files: { count: 1, bytes: 5 },
    });
    expect(new TextDecoder().decode(entries['payload/template/default/index.html'])).toBe('hello');
    expect(result.size).toBe(archive.byteLength);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      buildSnapshotArchive({
        workspaceRoot: workspace,
        managedBaseRoot: base,
        sourceWebsiteId: 'website-1',
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea',
        dbSchemaVersion: '3.2.26',
        outputPath: output,
      }),
    ).rejects.toThrow('output already exists');
  });

  it('blocks archive creation when managed core drift exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-snapshot-drift-'));
    const base = path.join(root, 'base');
    const workspace = path.join(root, 'workspace');
    await mkdir(path.join(base, 'apps'), { recursive: true });
    await mkdir(path.join(workspace, 'apps'), { recursive: true });
    await writeFile(path.join(base, 'apps', 'core.php'), 'managed');
    await writeFile(path.join(workspace, 'apps', 'core.php'), 'changed');
    await writeFile(
      path.join(base, '.cloudcrane-base'),
      'pbootcms=3.2.26\nsourceCommit=8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea\n',
    );
    await expect(
      buildSnapshotArchive({
        workspaceRoot: workspace,
        managedBaseRoot: base,
        sourceWebsiteId: 'website-1',
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea',
        dbSchemaVersion: '3.2.26',
        outputPath: path.join(root, 'snapshot.zip'),
      }),
    ).rejects.toThrow('CORE_COMPATIBILITY_BLOCKER');
  });

  it('validates manifest and blocks newer source databases', () => {
    const manifest = parseSnapshotManifest({
      artifactType: 'cloudcrane-pboot-site-snapshot',
      snapshotSchemaVersion: 1,
      cms: 'pbootcms',
      sourceWebsiteId: 'website-1',
      sourcePbootVersion: '3.2.26',
      sourceCoreCommit: '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea',
      dbEngine: 'sqlite',
      dbSchemaVersion: '3.2.26',
      createdAt: '2026-09-19T00:00:00.000Z',
      files: {
        count: 1,
        bytes: 10,
        entries: [{ path: 'data/pbootcms.db', size: 10, sha256: 'a'.repeat(64) }],
      },
    });
    expect(() =>
      assertSnapshotCanRestore({
        manifest,
        targetPbootVersion: '3.2.26',
        targetDbSchemaVersion: '3.2.24',
      }),
    ).toThrow('newer than target');
    expect(compareVersions('3.2.10', '3.2.9')).toBe(1);
    expect(compareVersions('3.2.9', '3.2.10')).toBe(-1);
    expect(
      planPbootMigrations({ engine: 'sqlite', sourceVersion: '3.2.24', targetVersion: '3.2.26' }),
    ).toHaveLength(1);
    expect(() =>
      planPbootMigrations({ engine: 'sqlite', sourceVersion: '3.2.16', targetVersion: '3.2.26' }),
    ).toThrow('missing official');
    expect(() =>
      planPbootMigrations({ engine: 'sqlite', sourceVersion: '3.2.26', targetVersion: '3.2.24' }),
    ).toThrow('downgrade');
    expect(() =>
      planPbootMigrations({ engine: 'mysql', sourceVersion: '3.2.24', targetVersion: '3.2.26' }),
    ).toThrow('missing official');
  });
});
