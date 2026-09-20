import { NextResponse } from 'next/server';
import {
  WebsiteProvisioningError,
  createProductionRuntime,
  createProductionWebsiteStore,
  createWebsite,
  listWebsites,
  publicWebsiteView,
  validateWebsiteName,
} from '../../../lib/server/website-provisioning.js';
import { previewUrlForWebsite } from '../../../lib/server/pboot-authorization.js';
import {
  assertSameOrigin,
  AuthorizationError,
  getUserRole,
  requireSession,
} from '@cloudcrane/auth';
import { auth } from '../../../lib/server/auth.js';
import { attachTemplateReference } from '../../../lib/server/template-attachment.js';
import { createTemplateCatalog, TEMPLATE_PUBLISHED } from '../../../lib/server/template-catalog.js';
import { finishAuditEvent, insertAuditEvent } from '@cloudcrane/db';
import { getActiveTraceContext } from '@cloudcrane/shared';
import { withWebRequestContext } from '../../../lib/server/observability.js';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return withWebRequestContext(request, 'GET /api/websites', async () => {
    try {
      const session = await requireSession(auth, request.headers);
      const { platform, store } = createProductionWebsiteStore(
        getUserRole(session) === 'admin' ? undefined : session.user.id,
      );
      try {
        const websites = await listWebsites(store);
        return NextResponse.json(
          websites.map((website) => ({ ...website, previewUrl: previewUrlForWebsite(website.id) })),
        );
      } finally {
        await platform.pool.end();
      }
    } catch (error) {
      if (error instanceof AuthorizationError)
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      return NextResponse.json({ error: { message: '获取网站列表失败' } }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withWebRequestContext(request, 'POST /api/websites', async () => {
    try {
      assertSameOrigin(request.headers);
    } catch (error) {
      if (error instanceof AuthorizationError)
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      throw error;
    }
    let session;
    try {
      session = await requireSession(auth, request.headers);
    } catch (error) {
      if (error instanceof AuthorizationError)
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      return NextResponse.json({ error: { message: '认证失败' } }, { status: 401 });
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: { code: 'INVALID_NAME', message: '请求内容无效' } },
        { status: 400 },
      );
    }
    const value =
      payload && typeof payload === 'object' ? (payload as { name?: unknown }).name : undefined;
    const templateId =
      payload && typeof payload === 'object'
        ? (payload as { templateId?: unknown }).templateId
        : undefined;
    if (templateId !== undefined && (typeof templateId !== 'string' || !isUuid(templateId)))
      return NextResponse.json(
        { error: { code: 'INVALID_TEMPLATE', message: '模板标识无效' } },
        { status: 400 },
      );
    let name: string;
    try {
      name = validateWebsiteName(value);
    } catch (error) {
      if (error instanceof WebsiteProvisioningError)
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: 400 },
        );
      return NextResponse.json(
        { error: { code: 'INVALID_NAME', message: '网站名称无效' } },
        { status: 400 },
      );
    }
    const catalog = templateId ? createTemplateCatalog() : undefined;
    let selectedTemplate;
    try {
      if (catalog && templateId) {
        const stored = await catalog.findById(templateId);
        if (!stored)
          return NextResponse.json(
            { error: { code: 'TEMPLATE_NOT_FOUND', message: '模板不存在' } },
            { status: 404 },
          );
        if (stored.status !== TEMPLATE_PUBLISHED)
          return NextResponse.json(
            { error: { code: 'TEMPLATE_NOT_PUBLISHED', message: '模板暂不可用' } },
            { status: 409 },
          );
        if (stored.cmsType !== 'pbootcms')
          return NextResponse.json(
            { error: { code: 'TEMPLATE_INCOMPATIBLE', message: '模板类型不兼容' } },
            { status: 409 },
          );
        selectedTemplate = stored;
      }
    } finally {
      if (catalog) await catalog.platform.pool.end();
    }
    const { platform, store } = createProductionWebsiteStore(session.user.id);
    const startedAt = Date.now();
    let auditId: string;
    try {
      const traceContext = getActiveTraceContext();
      try {
        auditId = await insertAuditEvent(platform.db, {
          actorType: getUserRole(session) === 'admin' ? 'admin' : 'user',
          actorUserId: session.user.id,
          operation: 'website.create',
          resourceType: 'website',
          requestId: request.headers.get('x-request-id') ?? undefined,
          traceId: traceContext.traceId,
          spanId: traceContext.spanId,
          status: 'PENDING',
          requestSummary: {
            nameLength: name.length,
            hasTemplate: Boolean(selectedTemplate),
          },
        });
      } catch {
        return NextResponse.json(
          { error: { code: 'AUDIT_UNAVAILABLE', message: '审计服务暂不可用，请稍后重试' } },
          { status: 503 },
        );
      }
      const result = await createWebsite(name, {
        store,
        ownerId: session.user.id,
        runtime: ({ websiteId, workspaceId }) => createProductionRuntime(websiteId, workspaceId),
        ...(selectedTemplate
          ? {
              template: selectedTemplate,
              attachTemplate: async ({ websiteId, workspaceId, template }) =>
                attachTemplateReference({ websiteId, workspaceId, template }),
            }
          : {}),
      });
      try {
        await finishAuditEvent(platform.db, auditId, {
          status: result.provisioned ? 'SUCCESS' : 'UNKNOWN',
          durationMs: Date.now() - startedAt,
          resultSummary: { provisioned: result.provisioned, websiteId: result.website.id },
        });
      } catch {
        return NextResponse.json(
          { error: { code: 'AUDIT_UNKNOWN', message: '网站已处理，但审计结果暂时无法确认' } },
          { status: 503 },
        );
      }
      return NextResponse.json(
        {
          ...publicWebsiteView(result.website),
          previewUrl: previewUrlForWebsite(result.website.id),
        },
        {
          status: result.provisioned ? 201 : 502,
        },
      );
    } catch (error) {
      try {
        await finishAuditEvent(platform.db, auditId!, {
          status: 'FAILED',
          durationMs: Date.now() - startedAt,
          errorCode: error instanceof WebsiteProvisioningError ? error.code : 'INTERNAL_ERROR',
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        });
      } catch {
        return NextResponse.json(
          { error: { code: 'AUDIT_UNKNOWN', message: '操作失败，但审计结果暂时无法确认' } },
          { status: 503 },
        );
      }
      if (error instanceof WebsiteProvisioningError)
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: 400 },
        );
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: '创建网站失败' } },
        { status: 500 },
      );
    } finally {
      await platform.pool.end();
    }
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
