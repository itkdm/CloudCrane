import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createPlatformDb, template } from '@cloudcrane/db';
import { parseSnapshotManifest, type SnapshotManifest } from '@cloudcrane/pboot-snapshot';
import unzipper from 'unzipper';
import {
  TEMPLATE_ARTIFACT_EXPANDED_MAX_BYTES,
  TEMPLATE_ARTIFACT_FILE_MAX_BYTES,
  TEMPLATE_ARTIFACT_MAX_BYTES,
  ZIP_DIRECTORY_TAIL_BYTES,
} from './infrastructure/template-limits.js';

const MAX_FILES = 20_000;
const ALLOWED_ROOTS = new Set(['template', 'skin', 'static']);
const FORBIDDEN_PARTS = new Set([
  '.git',
  '.env',
  '.aws',
  '.gnupg',
  '.ssh',
  'admin',
  'cache',
  'data',
  'license',
  'log',
  'runtime',
  'session',
  'secret',
  '.npmrc',
]);
const FORBIDDEN_FILE_NAMES = [
  /^\.env(?:\.|$)/,
  /^(?:admin|auth|config|credential|database|license|password|secret|token|user|users)(?:\.|$)/,
  /^(?:pbootcms|app|cloudcrane).*(?:\.db|\.sqlite|\.sql|\.log)$/,
  /^(?:id_rsa|id_ed25519|private[-_]?key)(?:\..*)?$/,
];
const FORBIDDEN_EXTENSIONS = new Set([
  '.bash',
  '.bin',
  '.cjs',
  '.crt',
  '.der',
  '.dll',
  '.exe',
  '.jks',
  '.key',
  '.p12',
  '.pem',
  '.phar',
  '.php',
  '.phtml',
  '.sh',
  '.so',
]);

type Options = {
  archive: string;
  name: string;
  description: string;
  category: string;
  demoUrl?: string;
  coverUrl?: string;
  sourceWebsiteId?: string;
};

const options = parseArgs(process.argv.slice(2));
const info = await stat(options.archive);
if (!info.isFile() || info.size <= 0 || info.size > TEMPLATE_ARTIFACT_MAX_BYTES)
  throw new Error('archive must be a non-empty ZIP smaller than 500 MB');
const openZipFile = unzipper.Open.file as unknown as (
  filename: string,
  options: { tailSize: number },
) => ReturnType<typeof unzipper.Open.file>;
const directory = await openZipFile(options.archive, {
  tailSize: ZIP_DIRECTORY_TAIL_BYTES,
});
const files = directory.files.filter((entry) => entry.type !== 'Directory');
if (files.length === 0) throw new Error('archive is empty');
const snapshotManifest = await readSnapshotManifest(files);
if (snapshotManifest) {
  await validateSnapshotEntries(files, snapshotManifest);
} else {
  validateLegacyEntries(files);
}

const id = randomUUID();
const artifactRoot = path.resolve(
  process.env.TEMPLATE_ARTIFACT_ROOT ?? '.cloudcrane-data/templates',
);
const storageKey = `template-${id}.zip`;
const target = path.resolve(artifactRoot, storageKey);
await mkdir(artifactRoot, { recursive: true });
await copyFile(options.archive, target, constants.COPYFILE_EXCL);
await chmod(target, 0o440);
const sha256 = await hashFile(target);
const platform = createPlatformDb();
try {
  await platform.db.insert(template).values({
    id,
    sourceWebsiteId: options.sourceWebsiteId ?? snapshotManifest?.sourceWebsiteId,
    name: options.name,
    description: options.description,
    category: options.category,
    coverUrl: options.coverUrl,
    demoUrl: options.demoUrl,
    cmsType: 'pbootcms',
    artifactStorageKey: storageKey,
    artifactSha256: sha256,
    artifactSize: info.size,
    artifactType: snapshotManifest ? 'cloudcrane-pboot-site-snapshot' : 'legacy-theme-reference',
    snapshotSchemaVersion: snapshotManifest?.snapshotSchemaVersion,
    sourcePbootVersion: snapshotManifest?.sourcePbootVersion,
    sourceCoreCommit: snapshotManifest?.sourceCoreCommit,
    dbEngine: snapshotManifest?.dbEngine,
    dbSchemaVersion: snapshotManifest?.dbSchemaVersion,
    status: 'published',
    publishedAt: new Date(),
  });
} catch (error) {
  await rm(target, { force: true }).catch(() => undefined);
  throw error;
} finally {
  await platform.pool.end();
}
process.stdout.write(`${JSON.stringify({ id, storageKey, sha256, size: info.size })}\n`);

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`argument must use --key=value: ${arg}`);
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) throw new Error(`invalid argument: ${arg}`);
    values.set(key, value);
  }
  const required = (key: string) => {
    const value = values.get(key)?.trim();
    if (!value) throw new Error(`missing --${key}`);
    return value;
  };
  return {
    archive: required('archive'),
    name: required('name'),
    description: required('description'),
    category: required('category'),
    demoUrl: values.get('demo-url'),
    coverUrl: values.get('cover-url'),
    sourceWebsiteId: values.get('source-website-id'),
  };
}

function validateEntry(value: string, type: string): string {
  if (
    type === 'SymbolicLink' ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /^[A-Za-z]:/.test(value)
  )
    throw new Error(`unsafe archive entry: ${value}`);
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../'))
    throw new Error(`path traversal archive entry: ${value}`);
  const parts = normalized.split('/');
  const root = parts[0];
  const basename = parts.at(-1)?.toLowerCase() ?? '';
  const extension = path.posix.extname(basename);
  if (
    !root ||
    !ALLOWED_ROOTS.has(root) ||
    parts.some((part) => FORBIDDEN_PARTS.has(part.toLowerCase())) ||
    FORBIDDEN_FILE_NAMES.some((pattern) => pattern.test(basename)) ||
    FORBIDDEN_EXTENSIONS.has(extension)
  )
    throw new Error(`archive entry is outside the approved template allowlist: ${value}`);
  return normalized;
}

function validateLegacyEntries(entries: unzipper.File[]): void {
  if (entries.length > MAX_FILES) throw new Error('archive contains too many files');
  let expandedBytes = 0;
  const normalizedPaths = new Set<string>();
  for (const entry of entries) {
    const normalized = validateEntry(entry.path, entry.type as string);
    if (normalizedPaths.has(normalized)) throw new Error(`duplicate archive entry: ${entry.path}`);
    normalizedPaths.add(normalized);
    const uncompressedSize = entry.uncompressedSize ?? 0;
    if (uncompressedSize > TEMPLATE_ARTIFACT_FILE_MAX_BYTES)
      throw new Error(`archive file is too large: ${entry.path}`);
    expandedBytes += uncompressedSize;
    if (expandedBytes > TEMPLATE_ARTIFACT_EXPANDED_MAX_BYTES)
      throw new Error('archive expands beyond 1 GB');
  }
}

async function readSnapshotManifest(entries: unzipper.File[]): Promise<SnapshotManifest | null> {
  const manifestEntry = entries.find((entry) => entry.path === 'manifest.json');
  if (!manifestEntry) return null;
  if (manifestEntry.type !== 'File') throw new Error('snapshot manifest must be a regular file');
  let value: unknown;
  try {
    value = JSON.parse((await manifestEntry.buffer()).toString('utf8'));
  } catch {
    throw new Error('snapshot manifest is not valid JSON');
  }
  return parseSnapshotManifest(value);
}

async function validateSnapshotEntries(
  entries: unzipper.File[],
  manifest: SnapshotManifest,
): Promise<void> {
  const payloadEntries = entries.filter((entry) => entry.path !== 'manifest.json');
  if (payloadEntries.length > MAX_FILES) throw new Error('snapshot contains too many files');
  const expected = new Map(manifest.files.entries.map((entry) => [entry.path, entry]));
  if (expected.size !== manifest.files.count || payloadEntries.length !== expected.size)
    throw new Error('snapshot manifest file count does not match payload');
  let expandedBytes = 0;
  const seen = new Set<string>();
  for (const entry of payloadEntries) {
    if (entry.type !== 'File' || !entry.path.startsWith('payload/'))
      throw new Error(`unsafe snapshot payload entry: ${entry.path}`);
    const relative = validateSnapshotPath(entry.path.slice('payload/'.length));
    if (seen.has(relative)) throw new Error(`duplicate snapshot entry: ${relative}`);
    const expectedEntry = expected.get(relative);
    if (!expectedEntry) throw new Error(`snapshot payload is not listed in manifest: ${relative}`);
    const contents = await entry.buffer();
    if (contents.byteLength !== expectedEntry.size)
      throw new Error(`snapshot payload size mismatch: ${relative}`);
    const sha256 = createHash('sha256').update(contents).digest('hex');
    if (sha256 !== expectedEntry.sha256)
      throw new Error(`snapshot payload hash mismatch: ${relative}`);
    if (contents.byteLength > TEMPLATE_ARTIFACT_FILE_MAX_BYTES)
      throw new Error(`snapshot file is too large: ${relative}`);
    expandedBytes += contents.byteLength;
    if (expandedBytes > TEMPLATE_ARTIFACT_EXPANDED_MAX_BYTES)
      throw new Error('snapshot expands beyond 1 GB');
    seen.add(relative);
  }
  if (expandedBytes !== manifest.files.bytes || seen.size !== expected.size)
    throw new Error('snapshot manifest byte count does not match payload');
}

function validateSnapshotPath(value: string): string {
  if (!value || value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value))
    throw new Error(`unsafe snapshot payload path: ${value}`);
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  )
    throw new Error(`path traversal snapshot payload: ${value}`);
  return normalized;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
