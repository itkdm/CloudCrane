import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

  it('does not read and hash the previous file when no expected checksum is requested', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-fs-'));
    const service = new FilesystemService(new WorkspacePathResolver(root));
    await service.write({ path: '/workspace/existing.txt', content: 'before' });
    const read = vi.spyOn(service, 'read');

    const result = await service.write({ path: '/workspace/existing.txt', content: 'after' });

    expect(read).not.toHaveBeenCalled();
    expect(result.size).toBe(Buffer.byteLength('after'));
    expect(result.sha256).toBe('f39592393ef0859cb196a52693d2cea00fb2df784b3c04ae54aa7cadb8e562f8');
  });

  it('bounds concurrent stat work while preserving directory entry order', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-fs-'));
    const directory = path.join(root, 'many');
    await mkdir(directory);
    await Promise.all(
      Array.from({ length: 70 }, (_, index) =>
        writeFile(path.join(directory, `file-${index}.txt`), String(index)),
      ),
    );
    const service = new FilesystemService(new WorkspacePathResolver(root));
    const instrumented = service as unknown as {
      stat: (request: { path: string }) => Promise<unknown>;
    };
    const originalStat = instrumented.stat.bind(service);
    let active = 0;
    let peak = 0;
    vi.spyOn(instrumented, 'stat').mockImplementation(async (request) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await originalStat(request);
      } finally {
        active -= 1;
      }
    });

    const result = await service.list({ path: '/workspace/many' });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(32);
    expect(result.entries.map((entry) => path.basename(entry.path))).toEqual(
      Array.from({ length: 70 }, (_, index) => `file-${index}.txt`).sort(),
    );
  });
});
