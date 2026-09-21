import { describe, expect, it } from 'vitest';
import {
  agentRun,
  auditEvent,
  runner,
  website,
  websiteSession,
  websiteShare,
  workspace,
} from './schema.js';
import { AUDIT_STATUSES } from './audit.js';

describe('platform schema', () => {
  it('exports the control-plane tables including the single audit table', () => {
    expect(
      Object.keys({
        website,
        workspace,
        websiteSession,
        websiteShare,
        agentRun,
        runner,
        auditEvent,
      }),
    ).toHaveLength(7);
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
