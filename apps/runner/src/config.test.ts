import { describe, expect, it } from 'vitest';
import { loadRunnerConfig } from './config.js';

describe('runner production configuration', () => {
  it('requires the shared reference root in production', () => {
    expect(() => loadRunnerConfig({ NODE_ENV: 'production' })).toThrow(
      'WORKSPACE_REFERENCE_ROOT is required in production',
    );
  });

  it('uses the configured shared reference root', () => {
    const config = loadRunnerConfig({
      NODE_ENV: 'production',
      WORKSPACE_REFERENCE_ROOT: '/srv/cloudcrane/references',
      TEMPLATE_ARTIFACT_ROOT: '/srv/cloudcrane/templates',
      WORKSPACE_MANAGED_PBOOT_BASE_ROOT: '/srv/cloudcrane/pbootcms-base',
    });

    expect(config.referenceRoot).toBe('/srv/cloudcrane/references');
  });
});
