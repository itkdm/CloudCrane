import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import unzipper from 'unzipper';
import {
  TEMPLATE_ARTIFACT_EXPANDED_MAX_BYTES,
  TEMPLATE_ARTIFACT_FILE_MAX_BYTES,
  ZIP_DIRECTORY_TAIL_BYTES,
} from './template-limits.js';

export const REFERENCE_EXPANDED_MAX_BYTES = 500 * 1024 * 1024;
export const REFERENCE_FILE_COUNT_MAX = 20_000;
export const REFERENCE_EXTRACTED_FILE_MAX_BYTES = 100 * 1024 * 1024;

export type MaterializedReference = {
  referenceId: string;
  name: string;
  logicalPath: string;
  sha256: string;
  size: number;
};

export type ReferenceMaterializationSource = 'user_upload' | 'template_snapshot';

export async function materializeReference(input: {
  archivePath: string;
  referenceRoot: string;
  workspaceId: string;
  originalFilename: string;
  sha256: string;
  size: number;
  archiveMaxBytes: number;
  expandedMaxBytes?: number;
  extractedFileMaxBytes?: number;
  source?: ReferenceMaterializationSource;
  templateId?: string;
  referenceId?: string;
}): Promise<MaterializedReference> {
  if (!input.originalFilename.toLowerCase().endsWith('.zip'))
    throw new ReferenceMaterializationError('ZIP file required', 400);
  if (input.size > input.archiveMaxBytes)
    throw new ReferenceMaterializationError('Reference upload is too large', 413);
  const handle = await open(input.archivePath, 'r');
  const signature = Buffer.alloc(4);
  await handle.read(signature, 0, 4, 0);
  await handle.close();
  if (signature[0] !== 0x50 || signature[1] !== 0x4b)
    throw new ReferenceMaterializationError('Uploaded file is not a valid ZIP archive', 422);

  const workspaceRoot = path.join(input.referenceRoot, input.workspaceId);
  const referenceId = input.referenceId ?? `ref_${randomUUID()}`;
  if (!/^ref_[0-9a-f-]+$/i.test(referenceId))
    throw new ReferenceMaterializationError('Invalid reference id', 422);
  const stagingRoot = path.join(
    input.referenceRoot,
    '.staging',
    input.workspaceId,
    `${referenceId}-${randomUUID()}`,
  );
  const expandedMaxBytes = input.expandedMaxBytes ?? REFERENCE_EXPANDED_MAX_BYTES;
  const extractedFileMaxBytes = input.extractedFileMaxBytes ?? REFERENCE_EXTRACTED_FILE_MAX_BYTES;
  const finalRoot = path.join(workspaceRoot, referenceId);
  const existingMetadata = await readFile(
    path.join(finalRoot, '.cloudcrane-reference.json'),
    'utf8',
  ).catch(() => null);
  if (existingMetadata) {
    try {
      const metadata = JSON.parse(existingMetadata) as {
        referenceId?: string;
        sha256?: string;
        templateId?: string;
        source?: string;
      };
      if (
        metadata.referenceId === referenceId &&
        metadata.sha256 === input.sha256 &&
        metadata.source === (input.source ?? 'user_upload') &&
        (!input.templateId || metadata.templateId === input.templateId)
      )
        return {
          referenceId,
          name: input.originalFilename,
          logicalPath: `/workspace/.cloudcrane/references/${referenceId}`,
          sha256: input.sha256,
          size: input.size,
        };
    } catch {
      // Treat malformed metadata as an unsafe existing materialization below.
    }
    throw new ReferenceMaterializationError(
      'Reference already exists with different contents',
      409,
    );
  }
  if (await stat(finalRoot).catch(() => null))
    throw new ReferenceMaterializationError(
      'Reference already exists with different contents',
      409,
    );
  await mkdir(stagingRoot, { recursive: true });
  try {
    const openZipFile = unzipper.Open.file as unknown as (
      filename: string,
      options: { tailSize: number },
    ) => ReturnType<typeof unzipper.Open.file>;
    const directory = await openZipFile(input.archivePath, {
      tailSize: ZIP_DIRECTORY_TAIL_BYTES,
    });
    const files = directory.files.filter((entry) => entry.type !== 'Directory');
    if (files.length === 0) throw new ReferenceMaterializationError('ZIP archive is empty', 422);
    if (files.length > REFERENCE_FILE_COUNT_MAX)
      throw new ReferenceMaterializationError('ZIP contains too many files', 422);
    const wrapper = singleWrapper(files.map((entry) => entry.path));
    const normalizedPaths = new Set<string>();
    let expanded = 0;
    let actualExpanded = 0;
    for (const entry of files) {
      const relative = normalizeEntryPath(entry.path, wrapper);
      if (!relative || (entry.type as string) === 'SymbolicLink')
        throw new ReferenceMaterializationError('ZIP contains an unsafe entry', 422);
      if (normalizedPaths.has(relative))
        throw new ReferenceMaterializationError('ZIP contains duplicate entries', 422);
      normalizedPaths.add(relative);
      const uncompressed = Number(entry.uncompressedSize ?? 0);
      if (!Number.isSafeInteger(uncompressed) || uncompressed > extractedFileMaxBytes)
        throw new ReferenceMaterializationError('ZIP contains an oversized file', 422);
      expanded += uncompressed;
      if (expanded > expandedMaxBytes)
        throw new ReferenceMaterializationError('Expanded ZIP is too large', 422);
      const target = path.join(stagingRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      let actualFileBytes = 0;
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          actualFileBytes += chunk.length;
          actualExpanded += chunk.length;
          if (actualFileBytes > extractedFileMaxBytes)
            return callback(new ReferenceMaterializationError('Expanded file is too large', 422));
          if (actualExpanded > expandedMaxBytes)
            return callback(new ReferenceMaterializationError('Expanded ZIP is too large', 422));
          callback(null, chunk);
        },
      });
      await pipeline(entry.stream(), counter, createWriteStream(target));
      const info = await lstat(target);
      if (info.isSymbolicLink())
        throw new ReferenceMaterializationError('ZIP symlinks are not allowed', 422);
    }
    await writeFile(
      path.join(stagingRoot, '.cloudcrane-reference.json'),
      JSON.stringify(
        {
          referenceId,
          kind: 'site_reference',
          source: input.source ?? 'user_upload',
          ...(input.templateId ? { templateId: input.templateId } : {}),
          originalFilename: input.originalFilename,
          sha256: input.sha256,
          size: input.size,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
    await mkdir(workspaceRoot, { recursive: true });
    await rename(stagingRoot, finalRoot);
    return {
      referenceId,
      name: input.originalFilename,
      logicalPath: `/workspace/.cloudcrane/references/${referenceId}`,
      sha256: input.sha256,
      size: input.size,
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function materializeTemplateReference(input: {
  artifactRoot: string;
  artifactStorageKey: string;
  artifactSha256: string;
  templateId: string;
  referenceRoot: string;
  workspaceId: string;
  maxBytes: number;
}): Promise<MaterializedReference> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.zip$/.test(input.artifactStorageKey))
    throw new ReferenceMaterializationError('Invalid template artifact key', 422);
  const artifactRoot = path.resolve(input.artifactRoot);
  const archivePath = path.resolve(artifactRoot, input.artifactStorageKey);
  if (!archivePath.startsWith(`${artifactRoot}${path.sep}`))
    throw new ReferenceMaterializationError('Invalid template artifact path', 422);
  const info = await lstat(archivePath).catch(() => null);
  if (!info?.isFile()) throw new ReferenceMaterializationError('Template artifact not found', 503);
  if (info.size > input.maxBytes)
    throw new ReferenceMaterializationError('Template artifact is too large', 413);
  const actualSha256 = await hashFile(archivePath);
  if (actualSha256 !== input.artifactSha256)
    throw new ReferenceMaterializationError('Template artifact hash mismatch', 503);
  return materializeReference({
    archivePath,
    referenceRoot: input.referenceRoot,
    workspaceId: input.workspaceId,
    originalFilename: path.basename(archivePath),
    sha256: actualSha256,
    size: info.size,
    archiveMaxBytes: input.maxBytes,
    expandedMaxBytes: TEMPLATE_ARTIFACT_EXPANDED_MAX_BYTES,
    extractedFileMaxBytes: TEMPLATE_ARTIFACT_FILE_MAX_BYTES,
    source: 'template_snapshot',
    templateId: input.templateId,
    referenceId: `ref_${input.templateId}`,
  });
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function removeReference(input: {
  referenceRoot: string;
  workspaceId: string;
  referenceId: string;
}): Promise<void> {
  if (!/^ref_[0-9a-f-]+$/i.test(input.referenceId))
    throw new ReferenceMaterializationError('Invalid reference id', 400);
  const workspaceRoot = path.resolve(input.referenceRoot, input.workspaceId);
  const target = path.resolve(workspaceRoot, input.referenceId);
  if (!target.startsWith(`${workspaceRoot}${path.sep}`))
    throw new ReferenceMaterializationError('Invalid reference path', 400);
  await rm(target, { recursive: true, force: true });
}

function normalizeEntryPath(value: string, wrapper?: string): string {
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value))
    throw new ReferenceMaterializationError('ZIP contains an unsafe path', 422);
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../'))
    throw new ReferenceMaterializationError('ZIP contains a path traversal entry', 422);
  const withoutWrapper =
    wrapper && normalized.startsWith(`${wrapper}/`)
      ? normalized.slice(wrapper.length + 1)
      : normalized;
  if (!withoutWrapper || withoutWrapper === '.' || withoutWrapper.startsWith('../'))
    throw new ReferenceMaterializationError('ZIP contains an unsafe path', 422);
  return withoutWrapper;
}

function singleWrapper(paths: string[]): string | undefined {
  const roots = new Set(paths.map((value) => value.split('/')[0]).filter(Boolean));
  return roots.size === 1 && paths.every((value) => value.includes('/'))
    ? [...roots][0]
    : undefined;
}

export class ReferenceMaterializationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ReferenceMaterializationError';
  }
}
