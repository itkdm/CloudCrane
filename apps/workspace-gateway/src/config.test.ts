import { describe, expect, it } from 'vitest';
import { loadGatewayConfig } from './config.js';

describe('workspace gateway production configuration', () => {
  it('requires both internal tokens', () => {
    expect(() => loadGatewayConfig({ NODE_ENV: 'production' })).toThrow(
      'WORKSPACE_GATEWAY_CLIENT_TOKEN is required in production',
    );
    expect(() =>
      loadGatewayConfig({ NODE_ENV: 'production', WORKSPACE_GATEWAY_CLIENT_TOKEN: 'real-client' }),
    ).toThrow('RUNNER_AUTH_TOKEN is required in production');
  });

  it('rejects development token defaults', () => {
    expect(() =>
      loadGatewayConfig({
        NODE_ENV: 'production',
        WORKSPACE_GATEWAY_CLIENT_TOKEN: 'dev-client-token',
        RUNNER_AUTH_TOKEN: 'real-runner',
      }),
    ).toThrow('must not use the development default');
  });
});
