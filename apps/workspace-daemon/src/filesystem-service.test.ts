import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesystemService } from './filesystem-service.js';
import { WorkspacePathResolver } from './workspace-path-resolver.js';

describe('FilesystemService', () => {
  it('creates, overwrites, and detects a write conflict', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-fs-'));
    const service = new FilesystemService(new WorkspacePathResolver(root));
    const first = await service.write({ path: '/workspace/site.txt', content: 'one' });
    expect((await service.read({ path: '/workspace/site.txt' })).content).toBe('one');
    const second = await service.write({
      path: '/workspace/site.txt',
      content: 'two',
      expectedSha256: first.sha256,
    });
    expect(second.sha256).not.toBe(first.sha256);
    await expect(
      service.write({
        path: '/workspace/site.txt',
        content: 'three',
        expectedSha256: first.sha256,
      }),
    ).rejects.toMatchObject({ code: 'FILE_CHANGED' });
  });

  it('truncates reads while returning the full content hash', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-fs-'));
    const service = new FilesystemService(new WorkspacePathResolver(root));
    const written = await service.write({ path: '/workspace/large.txt', content: '0123456789' });
    const result = await service.read({ path: '/workspace/large.txt', maxBytes: 4 });
    expect(result).toMatchObject({
      content: '0123',
      size: 10,
      truncated: true,
      sha256: written.sha256,
    });
  });
});
