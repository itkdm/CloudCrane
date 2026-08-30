import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  FsListResponse,
  FsMkdirRequest,
  FsReadRequest,
  FsReadResponse,
  FsStatResponse,
  FsWriteRequest,
  FsWriteResponse,
} from '@cloudcrane/workspace-protocol';
import { WorkspaceDaemonError } from './errors.js';
import { WorkspacePathResolver } from './workspace-path-resolver.js';

const DEFAULT_MAX_READ_BYTES = 1_048_576;

export class FilesystemService {
  constructor(private readonly resolver: WorkspacePathResolver) {}

  async read(request: FsReadRequest): Promise<FsReadResponse> {
    const filePath = await this.resolver.resolveExisting(request.path);
    const info = await stat(filePath);
    if (!info.isFile()) throw new WorkspaceDaemonError('INVALID_ARGUMENT', 'Path must be a file');
    const maxBytes = request.maxBytes ?? DEFAULT_MAX_READ_BYTES;
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    let captured = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('data', (chunk: string | Buffer) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buffer);
        if (captured < maxBytes) {
          const part = buffer.subarray(0, Math.min(buffer.length, maxBytes - captured));
          chunks.push(part);
          captured += part.length;
        }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    return {
      content: Buffer.concat(chunks).toString('utf8'),
      sha256: hash.digest('hex'),
      size: info.size,
      truncated: info.size > maxBytes,
    };
  }

  async write(request: FsWriteRequest): Promise<FsWriteResponse> {
    const filePath = await this.resolver.resolve(request.path);
    let currentSha: string | undefined;
    try {
      currentSha = (await this.read({ path: request.path, maxBytes: 10_485_760 })).sha256;
    } catch (error) {
      if (!(error instanceof WorkspaceDaemonError) || error.code !== 'FILE_NOT_FOUND') throw error;
    }
    if (request.expectedSha256 !== undefined && currentSha !== request.expectedSha256) {
      throw new WorkspaceDaemonError('FILE_CHANGED', 'File changed since it was read', {
        expectedSha256: request.expectedSha256,
        actualSha256: currentSha ?? null,
      });
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, request.content, { encoding: 'utf8', mode: 0o644 });
      await rename(temporaryPath, filePath);
    } finally {
      try {
        await unlink(temporaryPath);
      } catch {
        /* already renamed */
      }
    }
    const content = Buffer.from(request.content, 'utf8');
    return { sha256: createHash('sha256').update(content).digest('hex'), size: content.byteLength };
  }

  async stat(request: { path: string }): Promise<FsStatResponse> {
    const filePath = await this.resolver.resolveExisting(request.path);
    const info = await stat(filePath);
    return {
      path: request.path,
      type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'symlink',
      size: info.size,
      mode: info.mode,
      modifiedAt: info.mtime.toISOString(),
    };
  }

  async list(request: { path: string }): Promise<FsListResponse> {
    const directoryPath = await this.resolver.resolve(request.path, {
      mustExist: true,
      directory: true,
    });
    const names = await readdir(directoryPath);
    const entries = await Promise.all(
      names.map((name) => this.stat({ path: `${request.path.replace(/\/$/, '')}/${name}` })),
    );
    return { path: request.path, entries };
  }

  async mkdir(request: FsMkdirRequest): Promise<{ path: string }> {
    const directoryPath = await this.resolver.resolve(request.path);
    await mkdir(directoryPath, { recursive: request.recursive });
    return { path: request.path };
  }
}
