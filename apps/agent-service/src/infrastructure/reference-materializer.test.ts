import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  materializeReference,
  REFERENCE_EXTRACTED_FILE_MAX_BYTES,
  ReferenceMaterializationError,
} from './reference-materializer.js';

describe('materializeReference archive limits', () => {
  it('accepts valid ZIP archives with comments longer than unzipper default tail size', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-reference-comment-'));
    const archivePath = path.join(root, 'site.zip');
    const referenceRoot = path.join(root, 'references');
    const content = Buffer.from('hello');
    const filename = Buffer.from('index.php');
    const comment = Buffer.alloc(500, 0x41);
    const crc32 = 0x3610a686;
    const local = Buffer.alloc(30 + filename.length + content.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);
    content.copy(local, 30 + filename.length);
    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    filename.copy(central, 46);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(local.length, 16);
    end.writeUInt16LE(comment.length, 20);
    await writeFile(archivePath, Buffer.concat([local, central, end, comment]));
    try {
      await expect(
        materializeReference({
          archivePath,
          referenceRoot,
          workspaceId: 'workspace-a',
          originalFilename: 'site.zip',
          sha256: 'hash',
          size: local.length + central.length + end.length + comment.length,
          archiveMaxBytes: 1024 * 1024,
          extractedFileMaxBytes: 1024,
          expandedMaxBytes: 1024,
        }),
      ).resolves.toMatchObject({ name: 'site.zip' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the injected archive limit independently from extracted file limits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-reference-limit-'));
    const archivePath = path.join(root, 'site.zip');
    try {
      await expect(
        materializeReference({
          archivePath,
          referenceRoot: root,
          workspaceId: 'workspace-a',
          originalFilename: 'site.zip',
          sha256: 'hash',
          size: REFERENCE_EXTRACTED_FILE_MAX_BYTES + 1,
          archiveMaxBytes: REFERENCE_EXTRACTED_FILE_MAX_BYTES + 2,
        }),
      ).rejects.not.toBeInstanceOf(ReferenceMaterializationError);

      await expect(
        materializeReference({
          archivePath,
          referenceRoot: root,
          workspaceId: 'workspace-a',
          originalFilename: 'site.zip',
          sha256: 'hash',
          size: REFERENCE_EXTRACTED_FILE_MAX_BYTES + 2,
          archiveMaxBytes: REFERENCE_EXTRACTED_FILE_MAX_BYTES + 1,
        }),
      ).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
