import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import unzipper from 'unzipper';

export const REFERENCE_EXPANDED_MAX_BYTES = 500 * 1024 * 1024;
export const REFERENCE_FILE_COUNT_MAX = 20_000;
export const REFERENCE_FILE_MAX_BYTES = 100 * 1024 * 1024;

export type MaterializedReference = {
  referenceId: string;
  name: string;
  logicalPath: string;
  sha256: string;
  size: number;
};

export async function materializeReference(input: {
  archivePath: string;
  referenceRoot: string;
  workspaceId: string;
  originalFilename: string;
  sha256: string;
  size: number;
}): Promise<MaterializedReference> {
  if (!input.originalFilename.toLowerCase().endsWith('.zip'))
    throw new ReferenceMaterializationError('ZIP file required', 400);
  if (input.size > REFERENCE_FILE_MAX_BYTES)
    throw new ReferenceMaterializationError('Reference upload is too large', 413);
  const handle = await open(input.archivePath, 'r');
  const signature = Buffer.alloc(4);
  await handle.read(signature, 0, 4, 0);
  await handle.close();
  if (signature[0] !== 0x50 || signature[1] !== 0x4b)
    throw new ReferenceMaterializationError('Uploaded file is not a valid ZIP archive', 422);

  const workspaceRoot = path.join(input.referenceRoot, input.workspaceId);
  const referenceId = `ref_${randomUUID()}`;
  const stagingRoot = path.join(input.referenceRoot, '.staging', referenceId);
  const finalRoot = path.join(workspaceRoot, referenceId);
  await mkdir(stagingRoot, { recursive: true });
  try {
    const directory = await unzipper.Open.file(input.archivePath);
    const files = directory.files.filter((entry) => entry.type !== 'Directory');
    if (files.length === 0) throw new ReferenceMaterializationError('ZIP archive is empty', 422);
    if (files.length > REFERENCE_FILE_COUNT_MAX)
      throw new ReferenceMaterializationError('ZIP contains too many files', 422);
    const wrapper = singleWrapper(files.map((entry) => entry.path));
    let expanded = 0;
    for (const entry of files) {
      const relative = normalizeEntryPath(entry.path, wrapper);
      if (!relative || (entry.type as string) === 'SymbolicLink')
        throw new ReferenceMaterializationError('ZIP contains an unsafe entry', 422);
      const uncompressed = Number(entry.uncompressedSize ?? 0);
      if (!Number.isSafeInteger(uncompressed) || uncompressed > REFERENCE_FILE_MAX_BYTES)
        throw new ReferenceMaterializationError('ZIP contains an oversized file', 422);
      expanded += uncompressed;
      if (expanded > REFERENCE_EXPANDED_MAX_BYTES)
        throw new ReferenceMaterializationError('Expanded ZIP is too large', 422);
      const target = path.join(stagingRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await new Promise<void>((resolve, reject) => {
        entry.stream().pipe(createWriteStream(target)).on('finish', resolve).on('error', reject);
      });
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
          source: 'user_upload',
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
