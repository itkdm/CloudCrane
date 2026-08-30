import type { RemoteError } from '@cloudcrane/workspace-protocol';

export class GatewayRemoteError extends Error {
  constructor(
    public readonly remote: RemoteError,
    public readonly statusCode = 502,
  ) {
    super(remote.message);
    this.name = 'GatewayRemoteError';
  }
}

export function remoteError(
  code: RemoteError['code'],
  message: string,
  details?: Record<string, unknown>,
) {
  return new GatewayRemoteError({ code, message, ...(details ? { details } : {}) });
}
