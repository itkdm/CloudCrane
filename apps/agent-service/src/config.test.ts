import { describe, expect, it } from 'vitest';
import { loadAgentServiceConfig } from './config.js';

describe('agent service production configuration', () => {
  it('requires the internal token before starting in production', () => {
    expect(() => loadAgentServiceConfig({ NODE_ENV: 'production' })).toThrow(
      'AGENT_SERVICE_INTERNAL_TOKEN is required in production',
    );
  });

  it('requires the shared reference root when the token is present', () => {
    expect(() =>
      loadAgentServiceConfig({
        NODE_ENV: 'production',
        AGENT_SERVICE_INTERNAL_TOKEN: 'production-test-token',
      }),
    ).toThrow('WORKSPACE_REFERENCE_ROOT is required in production');
  });

  it('loads the shared reference root and template artifact limit', () => {
    const config = loadAgentServiceConfig({
      NODE_ENV: 'production',
      AGENT_SERVICE_INTERNAL_TOKEN: 'production-test-token',
      WORKSPACE_REFERENCE_ROOT: '/srv/cloudcrane/references',
      TEMPLATE_ARTIFACT_MAX_BYTES: '524288000',
    });

    expect(config.referenceRoot).toContain('srv');
    expect(config.templateArtifactMaxBytes).toBe(524288000);
  });
});
