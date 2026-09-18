import { describe, expect, it } from 'vitest';

import {
  shouldClearErrorOnRecovery,
  shouldClearErrorOnRunSettled,
  type WorkbenchError,
} from './types';

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

  it('clears transient connection and preview errors after recovery', () => {
    expect(shouldClearErrorOnRecovery({ source: 'connection', message: 'disconnected' })).toBe(
      true,
    );
    expect(shouldClearErrorOnRecovery({ source: 'preview-explicit', message: 'failed' })).toBe(
      true,
    );
    expect(
      shouldClearErrorOnRecovery({
        source: 'command',
        code: 'INVALID_ARGUMENT',
        message: 'Preview response is not pending',
      }),
    ).toBe(true);
    expect(shouldClearErrorOnRecovery({ source: 'command', message: 'failed' })).toBe(false);
    expect(shouldClearErrorOnRecovery(undefined)).toBe(false);
  });
});
