import {
  createProductionRuntime,
  createProductionWebsiteStore,
  WEBSITE_AUTHORIZATION_REQUIRED,
  WEBSITE_AUTHORIZING,
  WEBSITE_AUTHORIZING_STALE_AFTER_MS,
} from './website-provisioning.js';

export { WEBSITE_AUTHORIZING, WEBSITE_AUTHORIZING_STALE_AFTER_MS };

export const PBOOT_AUTHORIZATION_REQUIRED = WEBSITE_AUTHORIZATION_REQUIRED;

export function canConfigurePbootAuthorization(status: string): boolean {
  return status === PBOOT_AUTHORIZATION_REQUIRED;
}

export class PbootAuthorizationError extends Error {
  constructor(
    public readonly code: 'INVALID_CODE' | 'NOT_FOUND' | 'VERIFICATION_FAILED' | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'PbootAuthorizationError';
  }
}

export function normalizePbootAuthorization(value: unknown): string {
  if (typeof value !== 'string')
    throw new PbootAuthorizationError('INVALID_CODE', '请粘贴 PbootCMS 官方授权码');
  const normalized = value
    .replaceAll('，', ',')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
    .join(',');
  if (!normalized || normalized.length > 2048)
    throw new PbootAuthorizationError('INVALID_CODE', '授权码不能为空且不能超过 2KB');
  return normalized;
}

export function previewUrlForWebsite(previewSlug: string): string {
  const template = process.env.PREVIEW_GATEWAY_ORIGIN_TEMPLATE;
  if (!template) throw new Error('preview gateway origin template is required');
  return template
    .replace('{previewSlug}', previewSlug)
    .replace('{websiteId}', previewSlug)
    .replace(/\/$/, '');
}

export async function configurePbootAuthorization(websiteId: string, value: unknown) {
  const sn = normalizePbootAuthorization(value);
  const { platform, store } = createProductionWebsiteStore();
  try {
    const workspaceId = await store.findWorkspaceId?.(websiteId);
    if (!workspaceId) throw new PbootAuthorizationError('NOT_FOUND', '网站工作区不存在');
    if (!(await store.claimWebsiteAuthorization(websiteId)))
      throw new PbootAuthorizationError('INVALID_STATE', '网站当前不在待授权状态');
    try {
      const runtime = createProductionRuntime(websiteId, workspaceId);
      const configured = await runtime.configureAuthorization(sn);
      if (configured.status !== 'AUTHORIZED')
        throw new PbootAuthorizationError('VERIFICATION_FAILED', '授权码配置失败，请重试');
      const previewSlug = await store.findPreviewSlug?.(websiteId);
      if (!previewSlug) throw new PbootAuthorizationError('NOT_FOUND', '网站预览地址不存在');
      const previewUrl = previewUrlForWebsite(previewSlug);
      const verified = await runtime.verifyAuthorization(new URL(previewUrl).host);
      await store.updateWebsiteStatus(websiteId, verified ? 'ready' : PBOOT_AUTHORIZATION_REQUIRED);
      if (!verified)
        throw new PbootAuthorizationError(
          'VERIFICATION_FAILED',
          '授权码未匹配当前预览域名，请重新确认',
        );
      return { status: 'ready' as const };
    } catch (error) {
      try {
        await store.updateWebsiteStatus(websiteId, PBOOT_AUTHORIZATION_REQUIRED);
      } catch {
        // Preserve the original authorization error; a later reconciliation can recover the state.
      }
      throw error;
    }
  } finally {
    await platform.pool.end();
  }
}
