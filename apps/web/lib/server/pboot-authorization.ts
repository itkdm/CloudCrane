import { createProductionRuntime, createProductionWebsiteStore } from './website-provisioning.js';

export const PBOOT_AUTHORIZATION_REQUIRED = 'authorization_required';

export class PbootAuthorizationError extends Error {
  constructor(
    public readonly code: 'INVALID_CODE' | 'NOT_FOUND' | 'VERIFICATION_FAILED',
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

export function previewUrlForWebsite(websiteId: string): string {
  const template = process.env.PREVIEW_GATEWAY_ORIGIN_TEMPLATE;
  if (!template) throw new Error('preview gateway origin template is required');
  return template.replace('{websiteId}', websiteId).replace(/\/$/, '');
}

export async function configurePbootAuthorization(websiteId: string, value: unknown) {
  const sn = normalizePbootAuthorization(value);
  const { platform, store } = createProductionWebsiteStore();
  try {
    const workspaceId = await store.findWorkspaceId?.(websiteId);
    if (!workspaceId) throw new PbootAuthorizationError('NOT_FOUND', '网站工作区不存在');
    const runtime = createProductionRuntime(websiteId, workspaceId);
    const configured = await runtime.configureAuthorization(sn);
    if (configured.status !== 'AUTHORIZED')
      throw new PbootAuthorizationError('VERIFICATION_FAILED', '授权码配置失败，请重试');
    const previewUrl = previewUrlForWebsite(websiteId);
    const verified = await runtime.verifyAuthorization(new URL(previewUrl).host);
    await store.updateWebsiteStatus(websiteId, verified ? 'ready' : PBOOT_AUTHORIZATION_REQUIRED);
    if (!verified)
      throw new PbootAuthorizationError(
        'VERIFICATION_FAILED',
        '授权码未匹配当前预览域名，请重新确认',
      );
    return { status: 'ready' as const };
  } finally {
    await platform.pool.end();
  }
}
