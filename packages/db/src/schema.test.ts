import { describe, expect, it } from 'vitest';
import { agentRun, auditEvent, runner, website, websiteSession, workspace } from './schema.js';
import { AUDIT_STATUSES } from './audit.js';

describe('platform schema', () => {
  it('exports the control-plane tables including the single audit table', () => {
    expect(
      Object.keys({ website, workspace, websiteSession, agentRun, runner, auditEvent }),
    ).toHaveLength(6);
  });

  it('keeps audit status vocabulary explicit', () => {
    expect(AUDIT_STATUSES).toEqual([
      'PENDING',
      'RUNNING',
      'SUCCESS',
      'FAILED',
      'TIMEOUT',
      'CANCELLED',
      'UNKNOWN',
    ]);
  });
});
