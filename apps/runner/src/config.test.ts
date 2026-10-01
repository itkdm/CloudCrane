import path from 'node:path';
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
      PRODUCTION_HOST_SUFFIX: 'sites.example.com',
      RELEASE_ARTIFACT_ROOT: '/srv/cloudcrane/release-artifacts',
    });

    expect(config.referenceRoot).toBe('/srv/cloudcrane/references');
    expect(config.productionRoot).toBe('/var/lib/cloudcrane/production');
    expect(config.productionImage).toBe('cloudcrane-production-pboot:v1');
    expect(config.productionHostSuffix).toBe('sites.example.com');
    expect(config.releaseArtifactRoot).toBe('/srv/cloudcrane/release-artifacts');
    expect(config.managedPbootBaseRegistryRoot).toBe(
      path.join('/srv/cloudcrane', 'pbootcms-bases'),
    );
    expect(config.productionKeepReleases).toBe(5);
  });

  it('accepts production runtime storage and image configuration', () => {
    const config = loadRunnerConfig({
      PRODUCTION_ROOT: '/site-data/production',
      PRODUCTION_IMAGE: 'registry.example/cloudcrane/production-pboot:stable',
    });
    expect(config.productionRoot).toBe('/site-data/production');
    expect(config.productionImage).toBe('registry.example/cloudcrane/production-pboot:stable');
  });

  it('allows an explicit trusted managed Pboot base registry path', () => {
    const config = loadRunnerConfig({
      WORKSPACE_MANAGED_PBOOT_BASE_ROOT: '/srv/cloudcrane/pbootcms-base',
      WORKSPACE_MANAGED_PBOOT_BASE_REGISTRY_ROOT: '/mnt/cloudcrane/pboot-bases',
    });
    expect(config.managedPbootBaseRegistryRoot).toBe('/mnt/cloudcrane/pboot-bases');
  });
});
