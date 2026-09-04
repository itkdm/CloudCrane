import { describe, expect, it } from 'vitest';

import { shouldClearErrorOnRunSettled, type WorkbenchError } from './types';

describe('workbench transient errors', () => {
  it('clears an error only when the settled run matches', () => {
    const error: WorkbenchError = {
      source: 'command',
      message: 'request failed',
      runId: 'run-a',
    };

    expect(shouldClearErrorOnRunSettled(error, 'run-a')).toBe(true);
    expect(shouldClearErrorOnRunSettled(error, 'run-b')).toBe(false);
    expect(shouldClearErrorOnRunSettled(error, undefined)).toBe(false);
  });

  it('does not clear errors that are not tied to a run', () => {
    expect(
      shouldClearErrorOnRunSettled(
        { source: 'preview-explicit', message: 'preview unavailable' },
        'run-a',
      ),
    ).toBe(false);
    expect(shouldClearErrorOnRunSettled(undefined, 'run-a')).toBe(false);
  });
});
