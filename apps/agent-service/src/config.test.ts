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

  it('requires complete R2 configuration when the R2 driver is selected', () => {
    expect(() =>
      loadAgentServiceConfig({
        ATTACHMENT_STORAGE_DRIVER: 'r2',
      }),
    ).toThrow('ATTACHMENT_R2_ACCOUNT_ID is required when ATTACHMENT_STORAGE_DRIVER=r2');
  });

  it('loads the R2 credentials and bucket configuration', () => {
    const config = loadAgentServiceConfig({
      ATTACHMENT_STORAGE_DRIVER: 'r2',
      ATTACHMENT_R2_ACCOUNT_ID: 'test-account',
      ATTACHMENT_R2_BUCKET: 'cloudcrane-test',
      ATTACHMENT_R2_ACCESS_KEY_ID: 'test-id',
      ATTACHMENT_R2_SECRET_ACCESS_KEY: 'test-secret',
    });

    expect(config.attachmentR2AccountId).toBe('test-account');
    expect(config.attachmentR2Bucket).toBe('cloudcrane-test');
  });
});
