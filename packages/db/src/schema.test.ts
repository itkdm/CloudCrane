import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  agentRun,
  auditEvent,
  PRODUCTION_RUNTIME_STATUSES,
  productionRuntime,
  runner,
  WEBSITE_RELEASE_STATUSES,
  website,
  websiteRelease,
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
        productionRuntime,
        websiteRelease,
      }),
    ).toHaveLength(9);
  });

  it('defines independent Production and Release lifecycles with database guards', () => {
    expect(PRODUCTION_RUNTIME_STATUSES).toEqual([
      'provisioning',
      'authorization_required',
      'active',
      'failed',
      'stopped',
      'deleting',
    ]);
    expect(WEBSITE_RELEASE_STATUSES).toEqual([
      'preparing',
      'staged',
      'activating',
      'active',
      'superseded',
      'failed',
    ]);
    expect(getTableConfig(productionRuntime).checks.map((item) => item.name)).toContain(
      'production_runtime_status_check',
    );
    const releaseConfig = getTableConfig(websiteRelease);
    expect(releaseConfig.checks.map((item) => item.name)).toContain('website_release_status_check');
    expect(releaseConfig.indexes.map((item) => item.config.name)).toContain(
      'website_release_website_sequence_unique',
    );
    expect(releaseConfig.indexes.map((item) => item.config.name)).toContain(
      'website_release_one_active_per_website_unique',
    );
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
