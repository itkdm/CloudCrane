import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import OSS from 'ali-oss';

export type AttachmentStorageDriver = 'local' | 'oss';

export type AttachmentObject = {
  key: string;
  size: number;
  sha256: string;
  contentType: string;
};

export type AttachmentStorage = {
  put(input: {
    key: string;
    source: NodeJS.ReadableStream;
    contentType: string;
    maxBytes?: number;
  }): Promise<AttachmentObject>;
  open(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
};

export type OssAttachmentStorageOptions = {
  bucket: string;
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
  stsToken?: string;
  endpoint?: string;
  internal?: boolean;
  timeoutMs?: number;
};

function safeKey(key: string): string {
  const normalized = key.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0'))
    throw new Error('attachment storage key must be relative');
  const resolved = path.posix.normalize(normalized);
  if (resolved === '.' || resolved.startsWith('../') || resolved.includes('/../'))
    throw new Error('attachment storage key escapes storage root');
  return resolved;
}

export class LocalAttachmentStorage implements AttachmentStorage {
  constructor(private readonly root: string) {}

  async put(input: {
    key: string;
    source: NodeJS.ReadableStream;
    contentType: string;
    maxBytes?: number;
  }): Promise<AttachmentObject> {
    const key = safeKey(input.key);
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${path.resolve(this.root)}${path.sep}`))
      throw new Error('attachment storage key escapes storage root');
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.uploading-${process.pid}-${Date.now()}`;
    const hash = createHash('sha256');
    let size = 0;
    const counted = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (input.maxBytes !== undefined && size > input.maxBytes) {
          callback(new Error('attachment exceeds maximum size'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        input.source,
        counted,
        createWriteStream(temporary, { mode: 0o600, flags: 'wx' }),
      );
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { key, size, sha256: hash.digest('hex'), contentType: input.contentType };
  }

  async open(key: string): Promise<NodeJS.ReadableStream> {
    const safe = safeKey(key);
    const target = path.resolve(this.root, safe);
    const handle = await open(target, 'r');
    await handle.close();
    return createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    const safe = safeKey(key);
    const target = path.resolve(this.root, safe);
    await rm(target, { force: true });
  }
}

export class OssAttachmentStorage implements AttachmentStorage {
  private readonly client: OSS;
  private readonly timeout: number;

  constructor(options: OssAttachmentStorageOptions) {
    this.timeout = options.timeoutMs ?? 60_000;
    this.client = new OSS({
      bucket: options.bucket,
      region: options.region,
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      ...(options.stsToken ? { stsToken: options.stsToken } : {}),
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.internal !== undefined ? { internal: options.internal } : {}),
      secure: true,
      authorizationV4: true,
      timeout: this.timeout,
    });
  }

  async put(input: {
    key: string;
    source: NodeJS.ReadableStream;
    contentType: string;
    maxBytes?: number;
  }): Promise<AttachmentObject> {
    const key = safeKey(input.key);
    const hash = createHash('sha256');
    let size = 0;
    const counted = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (input.maxBytes !== undefined && size > input.maxBytes) {
          callback(new Error('attachment exceeds maximum size'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      const putOptions = {
        timeout: this.timeout,
        mime: input.contentType,
        meta: { uid: 'cloudcrane', pid: 'attachment' },
      } as unknown as OSS.PutStreamOptions;
      await this.client.putStream(key, input.source.pipe(counted), putOptions);
    } catch (error) {
      await this.client.delete(key).catch(() => undefined);
      throw error;
    }
    return { key, size, sha256: hash.digest('hex'), contentType: input.contentType };
  }

  async open(key: string): Promise<NodeJS.ReadableStream> {
    const result = await this.client.getStream(safeKey(key), { timeout: this.timeout });
    if (!result.stream) throw new Error('attachment object stream is unavailable');
    return result.stream as NodeJS.ReadableStream;
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(safeKey(key), { timeout: this.timeout });
  }
}

export function createAttachmentStorage(input: {
  driver: AttachmentStorageDriver;
  root: string;
  oss?: OssAttachmentStorageOptions;
}): AttachmentStorage {
  if (input.driver === 'local') return new LocalAttachmentStorage(input.root);
  if (!input.oss) throw new Error('OSS attachment storage configuration is required');
  return new OssAttachmentStorage(input.oss);
}
