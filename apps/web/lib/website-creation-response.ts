export type WebsiteCreationPayload = Record<string, unknown>;

export type WebsiteCreationHttpResponse = {
  status: 201 | 502;
  payload: WebsiteCreationPayload;
};

export function toWebsiteCreationResponse(
  payload: WebsiteCreationPayload,
  provisioned: boolean,
): WebsiteCreationHttpResponse {
  if (!provisioned) {
    return {
      status: 502,
      payload: {
        error: {
          code: 'PROVISIONING_FAILED',
          message: '创建网站失败',
        },
      },
    };
  }

  return { status: 201, payload };
}
