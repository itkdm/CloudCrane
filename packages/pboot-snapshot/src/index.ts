import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { z } from 'zod';
import { assertTrustedPbootRelease } from './pboot-releases.js';

export const SNAPSHOT_ARTIFACT_TYPE = 'cloudcrane-pboot-site-snapshot' as const;
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const SNAPSHOT_MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
export const SNAPSHOT_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
export const SNAPSHOT_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const SNAPSHOT_MAX_FILE_COUNT = 20_000;

export const snapshotManifestSchema = z.object({
  artifactType: z.literal(SNAPSHOT_ARTIFACT_TYPE),
  snapshotSchemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  cms: z.literal('pbootcms'),
  sourceWebsiteId: z.string().min(1).max(255),
  sourcePbootVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  sourceCoreCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  dbEngine: z.literal('sqlite'),
  dbSchemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  createdAt: z.string().datetime({ offset: true }),
  files: z.object({
    count: z.number().int().positive(),
    bytes: z.number().int().positive(),
    entries: z
      .array(
        z.object({
          path: z.string().min(1),
          size: z.number().int().nonnegative(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      )
      .min(1),
  }),
});

export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;

export type SnapshotPathClass = 'MANAGED_CORE' | 'SITE_STATE' | 'EPHEMERAL_RUNTIME';

const managedCoreExact = new Set([
  'index.php',
  'admin.php',
  'api.php',
  '.gitignore',
  'config/database.php',
  '.cloudcrane/bootstrap.json',
]);
const managedCorePrefixes = ['apps/', 'core/', 'rewrite/'];
const ephemeralPrefixes = [
  '.git/',
  '.cloudcrane/',
  'runtime/',
  'session/',
  'cache/',
  'log/',
  'data/backup/',
  'data/upgrade/',
];

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    path.posix.normalize(normalized) !== normalized ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`invalid workspace relative path: ${value}`);
  }
  return normalized;
}

export function classifySnapshotPath(value: string): SnapshotPathClass {
  const relative = normalizeRelativePath(value);
  if (
    ephemeralPrefixes.some(
      (prefix) => relative === prefix.slice(0, -1) || relative.startsWith(prefix),
    )
  )
    return 'EPHEMERAL_RUNTIME';
  if (
    managedCoreExact.has(relative) ||
    managedCorePrefixes.some((prefix) => relative.startsWith(prefix))
  )
    return 'MANAGED_CORE';
  return 'SITE_STATE';
}

export type CoreDriftEntry = {
  path: string;
  kind: 'modified' | 'added' | 'deleted' | 'symlink';
};

export type CoreDriftReport = {
  hasDrift: boolean;
  entries: CoreDriftEntry[];
};

export type SnapshotFileRecord = {
  path: string;
  size: number;
  sha256: string;
};

type FileRecord = { kind: 'file' | 'symlink'; sha256?: string };

async function inventory(root: string): Promise<Map<string, FileRecord>> {
  const result = new Map<string, FileRecord>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelativePath(path.relative(root, absolute));
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (entry.isSymbolicLink()) {
        result.set(relative, { kind: 'symlink' });
        continue;
      }
      if (!entry.isFile()) continue;
      const contents = await readFile(absolute);
      result.set(relative, {
        kind: 'file',
        sha256: createHash('sha256').update(contents).digest('hex'),
      });
    }
  }
  await visit(root);
  return result;
}

const forbiddenSiteStateNames = [
  /^\.env(?:\.|$)/i,
  /^(?:id_rsa|id_ed25519|private[-_]?key)(?:\..*)?$/i,
  /^(?:credentials?|secrets?|tokens?)\.(?:json|ya?ml|ini|conf)$/i,
  /^\.npmrc$/i,
];

export async function collectSiteStateInventory(root: string): Promise<SnapshotFileRecord[]> {
  const result: SnapshotFileRecord[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelativePath(path.relative(root, absolute));
      if (entry.isDirectory()) {
        if (classifySnapshotPath(relative) !== 'EPHEMERAL_RUNTIME') await visit(absolute);
        continue;
      }
      if (entry.isSymbolicLink()) throw new Error(`snapshot payload contains symlink: ${relative}`);
      if (!entry.isFile() || classifySnapshotPath(relative) !== 'SITE_STATE') continue;
      const basename = path.posix.basename(relative);
      if (forbiddenSiteStateNames.some((pattern) => pattern.test(basename)))
        throw new Error(`site state contains sensitive file: ${relative}`);
      const contents = await readFile(absolute);
      if (contents.byteLength > SNAPSHOT_MAX_FILE_BYTES)
        throw new Error(`site state file exceeds size limit: ${relative}`);
      result.push({
        path: relative,
        size: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      });
    }
  }
  await visit(root);
  if (result.length > SNAPSHOT_MAX_FILE_COUNT)
    throw new Error(`snapshot contains too many files: ${result.length}`);
  const expandedBytes = result.reduce((total, file) => total + file.size, 0);
  if (expandedBytes > SNAPSHOT_MAX_EXPANDED_BYTES)
    throw new Error(`snapshot expanded size exceeds limit: ${expandedBytes}`);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export function buildSnapshotManifest(input: {
  sourceWebsiteId: string;
  sourcePbootVersion: string;
  sourceCoreCommit: string;
  dbSchemaVersion: string;
  createdAt?: string;
  files: SnapshotFileRecord[];
}): SnapshotManifest {
  const manifest = {
    artifactType: SNAPSHOT_ARTIFACT_TYPE,
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    cms: 'pbootcms' as const,
    sourceWebsiteId: input.sourceWebsiteId,
    sourcePbootVersion: input.sourcePbootVersion,
    sourceCoreCommit: input.sourceCoreCommit,
    dbEngine: 'sqlite' as const,
    dbSchemaVersion: input.dbSchemaVersion,
    createdAt: input.createdAt ?? new Date().toISOString(),
    files: {
      count: input.files.length,
      bytes: input.files.reduce((total, file) => total + file.size, 0),
      entries: input.files,
    },
  };
  return snapshotManifestSchema.parse(manifest);
}

export async function buildSnapshotArchive(input: {
  workspaceRoot: string;
  managedBaseRoot: string;
  sourceWebsiteId: string;
  sourcePbootVersion: string;
  sourceCoreCommit: string;
  dbSchemaVersion: string;
  outputPath: string;
}): Promise<{ manifest: SnapshotManifest; size: number; sha256: string }> {
  const baseMarker = await readFile(
    path.join(input.managedBaseRoot, '.cloudcrane-base'),
    'utf8',
  ).catch(() => null);
  if (!baseMarker) throw new Error('managed Pboot base marker is missing');
  if (
    !baseMarker.includes(`pbootcms=${input.sourcePbootVersion}`) ||
    !baseMarker.includes(`sourceCommit=${input.sourceCoreCommit}`)
  )
    throw new Error('snapshot source metadata does not match the managed Pboot base');
  assertTrustedPbootRelease(input.sourcePbootVersion, input.sourceCoreCommit);
  const drift = await detectCoreDrift({
    workspaceRoot: input.workspaceRoot,
    managedBaseRoot: input.managedBaseRoot,
  });
  if (drift.hasDrift) {
    throw new Error(
      `CORE_COMPATIBILITY_BLOCKER: managed core drift detected (${drift.entries
        .map((entry) => `${entry.kind}:${entry.path}`)
        .join(', ')})`,
    );
  }

  const files = await collectSiteStateInventory(input.workspaceRoot);
  const manifest = buildSnapshotManifest({
    sourceWebsiteId: input.sourceWebsiteId,
    sourcePbootVersion: input.sourcePbootVersion,
    sourceCoreCommit: input.sourceCoreCommit,
    dbSchemaVersion: input.dbSchemaVersion,
    files,
  });
  const archiveEntries: Record<string, Uint8Array> = {
    'manifest.json': new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  };
  for (const file of files) {
    archiveEntries[`payload/${file.path}`] = await readFile(
      path.join(input.workspaceRoot, file.path),
    );
  }

  const archive = zipSync(archiveEntries, { level: 6 });
  if (archive.byteLength > SNAPSHOT_MAX_ARCHIVE_BYTES)
    throw new Error(`snapshot archive exceeds size limit: ${archive.byteLength}`);

  const parent = path.dirname(input.outputPath);
  const stagingPath = `${input.outputPath}.staging-${randomUUID()}`;
  await mkdir(parent, { recursive: true });
  try {
    try {
      await lstat(input.outputPath);
      throw new Error(`snapshot output already exists: ${input.outputPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeFile(stagingPath, archive, { flag: 'wx' });
    await rename(stagingPath, input.outputPath);
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw error;
  }

  return {
    manifest,
    size: archive.byteLength,
    sha256: createHash('sha256').update(archive).digest('hex'),
  };
}

export async function detectCoreDrift(input: {
  workspaceRoot: string;
  managedBaseRoot: string;
}): Promise<CoreDriftReport> {
  const [workspace, managedBase] = await Promise.all([
    inventory(input.workspaceRoot),
    inventory(input.managedBaseRoot),
  ]);
  const paths = new Set<string>([
    ...[...workspace.keys()].filter((value) => classifySnapshotPath(value) === 'MANAGED_CORE'),
    ...[...managedBase.keys()].filter((value) => classifySnapshotPath(value) === 'MANAGED_CORE'),
  ]);
  const entries: CoreDriftEntry[] = [];
  for (const relative of [...paths].sort()) {
    const actual = workspace.get(relative);
    const expected = managedBase.get(relative);
    if (actual?.kind === 'symlink' || expected?.kind === 'symlink') {
      entries.push({ path: relative, kind: 'symlink' });
    } else if (!expected && actual) {
      entries.push({ path: relative, kind: 'added' });
    } else if (expected && !actual) {
      entries.push({ path: relative, kind: 'deleted' });
    } else if (actual?.sha256 !== expected?.sha256) {
      entries.push({ path: relative, kind: 'modified' });
    }
  }
  return { hasDrift: entries.length > 0, entries };
}

export function parseSnapshotManifest(value: unknown): SnapshotManifest {
  return snapshotManifestSchema.parse(value);
}

export function assertSnapshotCanRestore(input: {
  manifest: SnapshotManifest;
  targetPbootVersion: string;
  targetDbSchemaVersion: string;
}): void {
  assertTrustedPbootRelease(input.manifest.sourcePbootVersion, input.manifest.sourceCoreCommit);
  const source = input.manifest.dbSchemaVersion;
  if (compareVersions(source, input.targetDbSchemaVersion) > 0)
    throw new Error(`snapshot database version is newer than target: ${source}`);
  if (!/^\d+\.\d+\.\d+$/.test(input.targetPbootVersion))
    throw new Error('target Pboot version is invalid');
  if (!/^\d+\.\d+\.\d+$/.test(input.targetDbSchemaVersion))
    throw new Error('target database schema version is invalid');
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const parts = value.split('.').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0))
      throw new Error(`invalid semantic version: ${value}`);
    return parts as [number, number, number];
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < a.length; index += 1) {
    const leftPart = a[index]!;
    const rightPart = b[index]!;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export async function assertNoSymlinks(root: string): Promise<void> {
  const entries = await inventory(root);
  const symlink = [...entries.entries()].find(([, value]) => value.kind === 'symlink');
  if (symlink) throw new Error(`snapshot payload contains symlink: ${symlink[0]}`);
  await lstat(root);
}
