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
      RELEASE_ARTIFACT_ROOT: '/srv/cloudcrane/release-artifacts',
    });

    expect(config.referenceRoot).toBe('/srv/cloudcrane/references');
    expect(config.productionRoot).toBe('/var/lib/cloudcrane/production');
    expect(config.productionImage).toBe('cloudcrane-production-pboot:v1');
    expect(config.releaseArtifactRoot).toBe('/srv/cloudcrane/release-artifacts');
  });

  it('accepts production runtime storage and image configuration', () => {
    const config = loadRunnerConfig({
      PRODUCTION_ROOT: '/site-data/production',
      PRODUCTION_IMAGE: 'registry.example/cloudcrane/production-pboot:stable',
    });
    expect(config.productionRoot).toBe('/site-data/production');
    expect(config.productionImage).toBe('registry.example/cloudcrane/production-pboot:stable');
  });
});
