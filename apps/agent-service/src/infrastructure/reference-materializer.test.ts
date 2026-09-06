import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  materializeReference,
  REFERENCE_EXTRACTED_FILE_MAX_BYTES,
  ReferenceMaterializationError,
} from './reference-materializer.js';

describe('materializeReference archive limits', () => {
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
