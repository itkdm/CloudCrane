import { Readable } from 'node:stream';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalAttachmentStorage } from './index.js';

describe('LocalAttachmentStorage', () => {
  it('writes atomically and returns content metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-attachments-'));
    const storage = new LocalAttachmentStorage(root);
    const object = await storage.put({
      key: 'user/site/session/file/blob',
      source: Readable.from(['hello']),
      contentType: 'text/plain',
    });
    expect(object.size).toBe(5);
    expect(object.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(await readFile(path.join(root, object.key), 'utf8')).toBe('hello');
    expect((await stat(path.join(root, object.key))).isFile()).toBe(true);
  });

  it('rejects path traversal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-attachments-'));
    const storage = new LocalAttachmentStorage(root);
    await expect(
      storage.put({ key: '../escape', source: Readable.from(['x']), contentType: 'text/plain' }),
    ).rejects.toThrow('escapes storage root');
  });
});
