import { describe, expect, it } from 'vitest';
import { publicWorkspaceErrorDetails } from './errors.js';

describe('workspace daemon error details', () => {
  it('keeps only bounded diagnostic fields', () => {
    expect(
      publicWorkspaceErrorDetails({
        executionId: 'exec-1',
        durationMs: 42,
        expectedSha256: 'a'.repeat(64),
        actualSha256: 'b'.repeat(64),
        content: 'secret file content',
        command: 'cat secret.txt',
      }),
    ).toEqual({
      executionId: 'exec-1',
      durationMs: 42,
      expectedSha256: 'a'.repeat(64),
      actualSha256: 'b'.repeat(64),
    });
  });
});
