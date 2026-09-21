import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';

export type AttachmentStorageDriver = 'local' | 'r2';

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

export type R2AttachmentStorageOptions = {
  bucket: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
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

export class R2AttachmentStorage implements AttachmentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly timeout: number;

  constructor(options: R2AttachmentStorageOptions) {
    this.timeout = options.timeoutMs ?? 60_000;
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      maxAttempts: 3,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 10_000,
        socketTimeout: this.timeout,
      }),
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
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: input.source.pipe(counted),
          ContentType: input.contentType,
          Metadata: { uid: 'cloudcrane', pid: 'attachment' },
        },
        partSize: 5 * 1024 * 1024,
        queueSize: 2,
        leavePartsOnError: false,
      });
      await upload.done();
    } catch (error) {
      await this.client
        .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
        .catch(() => undefined);
      throw error;
    }
    return { key, size, sha256: hash.digest('hex'), contentType: input.contentType };
  }

  async open(key: string): Promise<NodeJS.ReadableStream> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
    if (!result.Body || typeof (result.Body as { pipe?: unknown }).pipe !== 'function')
      throw new Error('attachment object stream is unavailable');
    return result.Body as unknown as NodeJS.ReadableStream;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }
}

export function createAttachmentStorage(input: {
  driver: AttachmentStorageDriver;
  root: string;
  r2?: R2AttachmentStorageOptions;
}): AttachmentStorage {
  if (input.driver === 'local') return new LocalAttachmentStorage(input.root);
  if (!input.r2) throw new Error('R2 attachment storage configuration is required');
  return new R2AttachmentStorage(input.r2);
}
