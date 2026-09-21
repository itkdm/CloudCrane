import { describe, expect, it } from 'vitest';
import { toWebsiteCreationResponse } from './website-creation-response';

describe('website creation HTTP response', () => {
  it('returns the website payload only after provisioning succeeds', () => {
    const payload = { id: 'website-id', status: 'authorization_required' };

    expect(toWebsiteCreationResponse(payload, true)).toEqual({
      status: 201,
      payload,
    });
  });

  it('never exposes a failed website object as a successful creation payload', () => {
    const response = toWebsiteCreationResponse(
      { id: 'cleaned-up-website-id', status: 'provisioning_failed' },
      false,
    );

    expect(response).toEqual({
      status: 502,
      payload: {
        error: {
          code: 'PROVISIONING_FAILED',
          message: '创建网站失败',
        },
      },
    });
    expect(response.payload).not.toHaveProperty('id');
  });
});
