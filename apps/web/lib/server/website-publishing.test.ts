import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionUrlForSlug, WebsitePublishError } from './website-publishing.js';

describe('production URL configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('expands an opaque production slug into its configured HTTPS host', () => {
    vi.stubEnv(
      'PRODUCTION_GATEWAY_ORIGIN_TEMPLATE',
      'https://{productionSlug}.sites.example.test/',
    );
    vi.stubEnv('PRODUCTION_HOST_SUFFIX', 'sites.example.test');

    expect(productionUrlForSlug('a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8')).toBe(
      'https://a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8.sites.example.test',
    );
  });

  it('rejects ingress hosts that do not match the configured authorization suffix', () => {
    vi.stubEnv('PRODUCTION_GATEWAY_ORIGIN_TEMPLATE', 'https://{productionSlug}.wrong.test/');
    vi.stubEnv('PRODUCTION_HOST_SUFFIX', 'sites.example.test');

    expect(() => productionUrlForSlug('a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8')).toThrowError(
      expect.objectContaining({ code: 'PRODUCTION_INGRESS_NOT_CONFIGURED' }),
    );
  });

  it('fails closed when the public ingress is not configured', () => {
    vi.stubEnv('PRODUCTION_GATEWAY_ORIGIN_TEMPLATE', '');
    vi.stubEnv('PRODUCTION_HOST_SUFFIX', 'sites.example.test');

    expect(() => productionUrlForSlug('a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8')).toThrow(
      WebsitePublishError,
    );
  });

  it('rejects a non-opaque slug even when the origin template matches it', () => {
    vi.stubEnv(
      'PRODUCTION_GATEWAY_ORIGIN_TEMPLATE',
      'https://{productionSlug}.sites.example.test/',
    );
    vi.stubEnv('PRODUCTION_HOST_SUFFIX', 'sites.example.test');

    expect(() => productionUrlForSlug('customer-controlled.sites.example.test')).toThrow(
      WebsitePublishError,
    );
  });
});
