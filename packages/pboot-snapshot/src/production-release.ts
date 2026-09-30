import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, link, mkdir, open, readdir, readFile, rm, chmod } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { Zip, ZipDeflate } from 'fflate';
import unzipper from 'unzipper';
import { z } from 'zod';
import { assertTrustedPbootRelease } from './pboot-releases.js';
import {
  SNAPSHOT_MAX_ARCHIVE_BYTES,
  SNAPSHOT_MAX_EXPANDED_BYTES,
  SNAPSHOT_MAX_FILE_BYTES,
  SNAPSHOT_MAX_FILE_COUNT,
  detectCoreDrift,
} from './index.js';

export const PRODUCTION_RELEASE_ARTIFACT_TYPE = 'cloudcrane-pboot-production-release' as const;
export const PRODUCTION_RELEASE_SCHEMA_VERSION = 1 as const;

export const productionReleaseManifestSchema = z.object({
  artifactType: z.literal(PRODUCTION_RELEASE_ARTIFACT_TYPE),
  schemaVersion: z.literal(PRODUCTION_RELEASE_SCHEMA_VERSION),
  releaseId: z.string().uuid(),
  sourceWebsiteId: z.string().uuid(),
  cms: z.literal('pbootcms'),
  sourcePbootVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  sourceCoreCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  sourceGitHead: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .nullable(),
  sourceGitDirty: z.boolean(),
  firstPublish: z.boolean(),
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
          fileClass: z.enum(['VERSIONED', 'PERSISTENT_INITIAL']),
        }),
      )
      .min(1),
  }),
});

export type ProductionReleaseManifest = z.infer<typeof productionReleaseManifestSchema>;
export type ProductionReleaseFileRecord = ProductionReleaseManifest['files']['entries'][number];

const excludedExact = new Set(['.gitignore', 'config/database.php', 'data/backup', 'data/upgrade']);
const excludedPrefixes = [
  '.git/',
  '.cloudcrane/',
  'runtime/',
  'session/',
  'cache/',
  'log/',
  'data/backup/',
  'data/upgrade/',
];
const persistentExact = new Set(['config/config.php', 'data/pbootcms.db']);
const persistentPrefixes = ['data/', 'static/upload/'];
const sensitiveNamePatterns = [
  /^\.env(?:\.|$)/i,
  /^(?:id_rsa|id_ed25519|private[-_]?key)(?:\..*)?$/i,
  /^(?:credentials?|secrets?|tokens?)\.(?:json|ya?ml|ini|conf)$/i,
  /^\.npmrc$/i,
];

function normalizeReleasePath(value: string): string {
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
    throw new Error(`invalid production release path: ${value}`);
  }
  return normalized;
}

export function classifyProductionReleasePath(
  value: string,
  firstPublish: boolean,
): 'VERSIONED' | 'PERSISTENT_INITIAL' | 'EXCLUDED' {
  const relative = normalizeReleasePath(value);
  if (
    excludedExact.has(relative) ||
    excludedPrefixes.some(
      (prefix) => relative === prefix.slice(0, -1) || relative.startsWith(prefix),
    )
  )
    return 'EXCLUDED';
  if (
    persistentExact.has(relative) ||
    persistentPrefixes.some((prefix) => relative.startsWith(prefix))
  )
    return firstPublish ? 'PERSISTENT_INITIAL' : 'EXCLUDED';
  return 'VERSIONED';
}

async function hashFile(
  filename: string,
  relative: string,
): Promise<{ size: number; sha256: string }> {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`production release payload is not a regular file: ${relative}`);
  if (info.size > SNAPSHOT_MAX_FILE_BYTES)
    throw new Error(`production release file exceeds size limit: ${relative}`);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filename)) {
    size += chunk.length;
    if (size > SNAPSHOT_MAX_FILE_BYTES)
      throw new Error(`production release file exceeds size limit: ${relative}`);
    hash.update(chunk);
  }
  if (size !== info.size)
    throw new Error(`production release file changed while hashing: ${relative}`);
  return { size, sha256: hash.digest('hex') };
}

export async function collectProductionReleaseInventory(
  workspaceRoot: string,
  firstPublish: boolean,
): Promise<ProductionReleaseFileRecord[]> {
  const root = path.resolve(workspaceRoot);
  const result: ProductionReleaseFileRecord[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeReleasePath(path.relative(root, absolute));
      const fileClass = classifyProductionReleasePath(relative, firstPublish);
      if (fileClass === 'EXCLUDED') continue;
      if (entry.isSymbolicLink())
        throw new Error(`production release contains symlink: ${relative}`);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (sensitiveNamePatterns.some((pattern) => pattern.test(path.posix.basename(relative))))
        throw new Error(`production release contains sensitive file: ${relative}`);
      const file = await hashFile(absolute, relative);
      result.push({ path: relative, ...file, fileClass });
      if (result.length > SNAPSHOT_MAX_FILE_COUNT)
        throw new Error(`production release contains too many files: ${result.length}`);
    }
  }
  await visit(root);
  const expandedBytes = result.reduce((total, file) => total + file.size, 0);
  if (expandedBytes > SNAPSHOT_MAX_EXPANDED_BYTES)
    throw new Error(`production release expanded size exceeds limit: ${expandedBytes}`);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export async function buildProductionReleaseArchive(input: {
  workspaceRoot: string;
  managedBaseRoot: string;
  sourceWebsiteId: string;
  sourcePbootVersion: string;
  sourceCoreCommit: string;
  sourceGitHead: string | null;
  sourceGitDirty: boolean;
  firstPublish: boolean;
  releaseId?: string;
  createdAt?: string;
  outputPath: string;
}): Promise<{ manifest: ProductionReleaseManifest; size: number; sha256: string }> {
  const releaseId = z
    .string()
    .uuid()
    .parse(input.releaseId ?? randomUUID());
  const marker = await readFile(path.join(input.managedBaseRoot, '.cloudcrane-base'), 'utf8').catch(
    () => null,
  );
  if (
    !marker ||
    !marker.includes(`pbootcms=${input.sourcePbootVersion}`) ||
    !marker.includes(`sourceCommit=${input.sourceCoreCommit}`)
  )
    throw new Error('production release source metadata does not match the managed Pboot base');
  assertTrustedPbootRelease(input.sourcePbootVersion, input.sourceCoreCommit);
  const drift = await detectCoreDrift({
    workspaceRoot: input.workspaceRoot,
    managedBaseRoot: input.managedBaseRoot,
  });
  if (drift.hasDrift)
    throw new Error(
      `CORE_COMPATIBILITY_BLOCKER: managed core drift detected (${drift.entries.map((entry) => `${entry.kind}:${entry.path}`).join(', ')})`,
    );

  const files = await collectProductionReleaseInventory(input.workspaceRoot, input.firstPublish);
  const manifest = productionReleaseManifestSchema.parse({
    artifactType: PRODUCTION_RELEASE_ARTIFACT_TYPE,
    schemaVersion: PRODUCTION_RELEASE_SCHEMA_VERSION,
    releaseId,
    sourceWebsiteId: input.sourceWebsiteId,
    cms: 'pbootcms',
    sourcePbootVersion: input.sourcePbootVersion,
    sourceCoreCommit: input.sourceCoreCommit,
    sourceGitHead: input.sourceGitHead,
    sourceGitDirty: input.sourceGitDirty,
    firstPublish: input.firstPublish,
    createdAt: input.createdAt ?? new Date().toISOString(),
    files: {
      count: files.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      entries: files,
    },
  });
  const root = path.resolve(input.workspaceRoot);
  const archivePath = path.resolve(input.outputPath);
  const workspacePrefix = `${root}${path.sep}`;
  const stagingPath = `${archivePath}.staging-${randomUUID()}`;
  const parent = path.dirname(archivePath);
  await mkdir(parent, { recursive: true });
  try {
    await lstat(archivePath);
    throw new Error(`production release output already exists: ${archivePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const handle = await open(stagingPath, 'wx', 0o440);
  const hash = createHash('sha256');
  let size = 0;
  let writeQueue = Promise.resolve();
  let streamError: Error | undefined;
  let resolveFinal!: () => void;
  let rejectFinal!: (error: Error) => void;
  const outputFinal = new Promise<void>((resolve, reject) => {
    resolveFinal = resolve;
    rejectFinal = reject;
  });
  const zip = new Zip();
  zip.ondata = (error, chunk, final) => {
    if (error) {
      streamError = error;
      rejectFinal(error);
      return;
    }
    if (chunk) {
      size += chunk.byteLength;
      if (size > SNAPSHOT_MAX_ARCHIVE_BYTES) {
        streamError = new Error(`production release archive exceeds size limit: ${size}`);
        rejectFinal(streamError);
        return;
      }
      hash.update(chunk);
      writeQueue = writeQueue
        .then(async () => {
          let offset = 0;
          while (offset < chunk.byteLength) {
            const written = await handle.write(chunk, offset, chunk.byteLength - offset);
            if (!written.bytesWritten)
              throw new Error('production release archive write made no progress');
            offset += written.bytesWritten;
          }
        })
        .catch((writeError: unknown) => {
          streamError =
            writeError instanceof Error ? writeError : new Error('archive write failed');
          rejectFinal(streamError);
        });
    }
    if (final) resolveFinal();
  };
  const addBytes = async (name: string, bytes: Uint8Array): Promise<void> => {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      entry.push(bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.length)));
      await writeQueue;
      if (streamError) throw streamError;
    }
    entry.push(new Uint8Array(0), true);
    await writeQueue;
    if (streamError) throw streamError;
  };
  try {
    await addBytes(
      'manifest.json',
      new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    );
    for (const file of files) {
      const absolute = path.resolve(root, file.path);
      if (!absolute.startsWith(workspacePrefix))
        throw new Error(`production release path escaped workspace: ${file.path}`);
      const before = await lstat(absolute);
      if (!before.isFile() || before.isSymbolicLink())
        throw new Error(`production release payload changed type: ${file.path}`);
      const entry = new ZipDeflate(`payload/${file.path}`, { level: 6 });
      zip.add(entry);
      const actualHash = createHash('sha256');
      let actualSize = 0;
      for await (const chunk of createReadStream(absolute)) {
        actualSize += chunk.length;
        actualHash.update(chunk);
        entry.push(chunk);
        await writeQueue;
        if (streamError) throw streamError;
      }
      const after = await lstat(absolute);
      if (
        actualSize !== file.size ||
        actualHash.digest('hex') !== file.sha256 ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        throw new Error(`production release source changed while archiving: ${file.path}`);
      entry.push(new Uint8Array(0), true);
      await writeQueue;
      if (streamError) throw streamError;
    }
    zip.end();
    await outputFinal;
    await writeQueue;
    if (streamError) throw streamError;
    await handle.sync();
    await handle.close();
    await link(stagingPath, archivePath);
    await rm(stagingPath, { force: true });
  } catch (error) {
    zip.terminate();
    await writeQueue.catch(() => undefined);
    await handle.close().catch(() => undefined);
    await rm(stagingPath, { force: true });
    throw error;
  }
  return { manifest, size, sha256: hash.digest('hex') };
}

export function parseProductionReleaseManifest(value: unknown): ProductionReleaseManifest {
  return productionReleaseManifestSchema.parse(value);
}

export async function extractProductionReleaseArchive(input: {
  archivePath: string;
  expectedSha256: string;
  expectedWebsiteId: string;
  expectedReleaseId: string;
  destination: string;
}): Promise<ProductionReleaseManifest> {
  const archivePath = path.resolve(input.archivePath);
  const archiveInfo = await lstat(archivePath);
  if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink())
    throw new Error('production release archive is not a regular file');
  if (archiveInfo.size <= 0 || archiveInfo.size > SNAPSHOT_MAX_ARCHIVE_BYTES)
    throw new Error('production release archive exceeds size limit');
  const archiveHash = createHash('sha256');
  for await (const chunk of createReadStream(archivePath)) archiveHash.update(chunk);
  if (archiveHash.digest('hex') !== input.expectedSha256)
    throw new Error('production release archive SHA-256 mismatch');

  const directory = await unzipper.Open.file(archivePath);
  if (directory.files.length > SNAPSHOT_MAX_FILE_COUNT + 1)
    throw new Error('production release archive contains too many entries');
  const manifestEntry = directory.files.find((entry) => entry.path === 'manifest.json');
  if (!manifestEntry || manifestEntry.type !== 'File' || manifestEntry.uncompressedSize > 1_048_576)
    throw new Error('production release manifest is missing or invalid');
  let manifest: ProductionReleaseManifest;
  try {
    manifest = productionReleaseManifestSchema.parse(
      JSON.parse((await manifestEntry.buffer()).toString('utf8')),
    );
  } catch (error) {
    throw new Error('production release manifest is invalid', { cause: error });
  }
  if (
    manifest.sourceWebsiteId !== input.expectedWebsiteId ||
    manifest.releaseId !== input.expectedReleaseId
  )
    throw new Error('production release identity does not match the requested deployment');
  assertTrustedPbootRelease(manifest.sourcePbootVersion, manifest.sourceCoreCommit);
  if (directory.files.length !== manifest.files.count + 1)
    throw new Error('production release entry count does not match the manifest');

  const expected = new Map(manifest.files.entries.map((file) => [file.path, file]));
  if (expected.size !== manifest.files.count)
    throw new Error('production release manifest contains duplicate paths');
  const destination = path.resolve(input.destination);
  await mkdir(destination, { recursive: false });
  let expandedBytes = 0;
  const seen = new Set<string>();
  try {
    for (const entry of directory.files) {
      if (entry === manifestEntry) continue;
      if (entry.type !== 'File' || !entry.path.startsWith('payload/'))
        throw new Error(`production release contains an unsupported ZIP entry: ${entry.path}`);
      const relative = normalizeReleasePath(entry.path.slice('payload/'.length));
      if (seen.has(relative))
        throw new Error(`production release contains duplicate path: ${relative}`);
      seen.add(relative);
      const record = expected.get(relative);
      if (
        !record ||
        entry.uncompressedSize !== record.size ||
        record.size > SNAPSHOT_MAX_FILE_BYTES ||
        classifyProductionReleasePath(relative, manifest.firstPublish) !== record.fileClass
      )
        throw new Error(`production release payload does not match manifest: ${relative}`);
      expandedBytes += record.size;
      if (expandedBytes > SNAPSHOT_MAX_EXPANDED_BYTES)
        throw new Error('production release expanded size exceeds limit');
      const target = path.resolve(destination, relative);
      if (!target.startsWith(`${destination}${path.sep}`))
        throw new Error(`production release path escaped destination: ${relative}`);
      await mkdir(path.dirname(target), { recursive: true });
      const hash = createHash('sha256');
      let size = 0;
      const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size > record.size)
            return callback(new Error('production release payload size mismatch'));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        entry.stream(),
        verifier,
        createWriteStream(target, { flags: 'wx', mode: 0o444 }),
      );
      if (size !== record.size || hash.digest('hex') !== record.sha256)
        throw new Error(`production release payload integrity check failed: ${relative}`);
      await chmod(target, 0o444);
    }
    if (seen.size !== expected.size)
      throw new Error('production release manifest references missing payload files');
    const makeReadOnly = async (directoryPath: string): Promise<void> => {
      for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
        if (entry.isDirectory()) await makeReadOnly(path.join(directoryPath, entry.name));
      }
      await chmod(directoryPath, 0o555);
    };
    await makeReadOnly(destination);
    return manifest;
  } catch (error) {
    await chmod(destination, 0o700).catch(() => undefined);
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
