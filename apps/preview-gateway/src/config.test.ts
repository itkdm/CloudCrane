import { describe, expect, it } from 'vitest';
import { loadPreviewGatewayConfig } from './config.js';

describe('preview gateway production configuration', () => {
  it('rejects a missing signing secret', () => {
    expect(() => loadPreviewGatewayConfig({ NODE_ENV: 'production' })).toThrow(
      'PREVIEW_SIGNING_SECRET is required in production',
    );
  });

  it('rejects the development signing secret', () => {
    expect(() =>
      loadPreviewGatewayConfig({
        NODE_ENV: 'production',
        PREVIEW_SIGNING_SECRET: 'cloudcrane-preview-dev-secret',
      }),
    ).toThrow('must not use the development default');
  });
});
