import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createPlatformDb, template } from '@cloudcrane/db';
import unzipper from 'unzipper';
import {
  TEMPLATE_ARTIFACT_EXPANDED_MAX_BYTES,
  TEMPLATE_ARTIFACT_FILE_MAX_BYTES,
  TEMPLATE_ARTIFACT_MAX_BYTES,
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
const directory = await unzipper.Open.file(options.archive);
const files = directory.files.filter((entry) => entry.type !== 'Directory');
if (files.length === 0) throw new Error('archive is empty');
if (files.length > MAX_FILES) throw new Error('archive contains too many files');
let expandedBytes = 0;
const normalizedPaths = new Set<string>();
for (const entry of files) {
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
    sourceWebsiteId: options.sourceWebsiteId,
    name: options.name,
    description: options.description,
    category: options.category,
    coverUrl: options.coverUrl,
    demoUrl: options.demoUrl,
    cmsType: 'pbootcms',
    artifactStorageKey: storageKey,
    artifactSha256: sha256,
    artifactSize: info.size,
    status: 'published',
    publishedAt: new Date(),
  });
} catch (error) {
  await rm(target, { force: true }).catch(() => undefined);
  throw error;
} finally {
  await platform.pool.end();
}
console.log(JSON.stringify({ id, storageKey, sha256, size: info.size }));

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

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
