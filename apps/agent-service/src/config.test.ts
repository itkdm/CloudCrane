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

  it('requires complete OSS configuration when the OSS driver is selected', () => {
    expect(() =>
      loadAgentServiceConfig({
        ATTACHMENT_STORAGE_DRIVER: 'oss',
      }),
    ).toThrow('ATTACHMENT_OSS_BUCKET is required when ATTACHMENT_STORAGE_DRIVER=oss');
  });

  it('parses the OSS internal endpoint flag without treating "false" as true', () => {
    const config = loadAgentServiceConfig({
      ATTACHMENT_STORAGE_DRIVER: 'oss',
      ATTACHMENT_OSS_BUCKET: 'cloudcrane-test',
      ATTACHMENT_OSS_REGION: 'oss-cn-hangzhou',
      ATTACHMENT_OSS_ACCESS_KEY_ID: 'test-id',
      ATTACHMENT_OSS_ACCESS_KEY_SECRET: 'test-secret',
      ATTACHMENT_OSS_INTERNAL: 'false',
    });

    expect(config.attachmentOssInternal).toBe(false);
  });
});
