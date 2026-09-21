import { NextResponse } from 'next/server';
import { assertSameOrigin, AuthorizationError, requireWebsiteAccess } from '@cloudcrane/auth';
import { finishAuditEvent, insertAuditEvent } from '@cloudcrane/db';
import { auth, authDb } from '../../../../../lib/server/auth.js';
import {
  canConfigurePbootAuthorization,
  configurePbootAuthorization,
  WEBSITE_AUTHORIZING,
  WEBSITE_AUTHORIZING_STALE_AFTER_MS,
  PbootAuthorizationError,
} from '../../../../../lib/server/pboot-authorization.js';
import { createLogger, getActiveTraceContext } from '@cloudcrane/shared';
import { withWebRequestContext } from '../../../../../lib/server/observability.js';

export const runtime = 'nodejs';

const logger = createLogger('web.api.pboot-authorization');

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(
    request,
    'POST /api/websites/:websiteId/pboot-authorization',
    async () => {
      const { websiteId } = await params;
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
      let access: Awaited<ReturnType<typeof requireWebsiteAccess>>;
      try {
        access = await requireWebsiteAccess(authDb, auth, request.headers, websiteId);
      } catch (error) {
        if (error instanceof AuthorizationError)
          return NextResponse.json(
            { error: { code: error.code, message: error.message } },
            { status: error.status },
          );
        return NextResponse.json(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: '认证失败' } },
          { status: 401 },
        );
      }
      const canReclaimStaleAuthorization =
        access.website.status === WEBSITE_AUTHORIZING &&
        access.website.updatedAt.getTime() < Date.now() - WEBSITE_AUTHORIZING_STALE_AFTER_MS;
      if (!canConfigurePbootAuthorization(access.website.status) && !canReclaimStaleAuthorization)
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message:
                access.website.status === 'ready'
                  ? '网站已经完成授权，无需重复配置'
                  : `网站当前状态为 ${access.website.status}，暂时不能配置授权`,
            },
          },
          { status: 409 },
        );
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return NextResponse.json(
          { error: { code: 'INVALID_CODE', message: '请求内容无效' } },
          { status: 400 },
        );
      }
      const sn =
        payload && typeof payload === 'object' ? (payload as { sn?: unknown }).sn : undefined;
      const startedAt = Date.now();
      let auditId: string;
      try {
        auditId = await insertAuditEvent(authDb, {
          actorType: access.isAdmin ? 'admin' : 'user',
          actorUserId: access.session.user.id,
          websiteId,
          operation: 'pboot.authorization',
          resourceType: 'website',
          requestId: request.headers.get('x-request-id') ?? undefined,
          ...getActiveTraceContext(),
          status: 'PENDING',
          requestSummary: { provided: true },
        });
      } catch {
        return NextResponse.json(
          { error: { code: 'AUDIT_UNAVAILABLE', message: '审计服务暂不可用，请稍后重试' } },
          { status: 503 },
        );
      }
      let operationCompleted = false;
      try {
        const result = await configurePbootAuthorization(websiteId, sn);
        operationCompleted = true;
        await finishAuditEvent(authDb, auditId, {
          status: 'SUCCESS',
          durationMs: Date.now() - startedAt,
          resultSummary: { status: result.status },
        });
        return NextResponse.json(result);
      } catch (error) {
        if (operationCompleted) {
          logger.error(
            {
              event: 'audit.finalization.failed',
              operation: 'pboot.authorization',
              websiteId,
              outcome: 'business_succeeded',
            },
            'Pboot authorization completed but audit finalization failed',
          );
          return NextResponse.json({ status: 'ready' });
        }
        try {
          await finishAuditEvent(authDb, auditId, {
            status: error instanceof PbootAuthorizationError ? 'FAILED' : 'UNKNOWN',
            durationMs: Date.now() - startedAt,
            errorCode: error instanceof PbootAuthorizationError ? error.code : 'INTERNAL_ERROR',
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          });
        } catch {
          return NextResponse.json(
            { error: { code: 'AUDIT_UNKNOWN', message: '授权失败，但审计结果暂时无法确认' } },
            { status: 503 },
          );
        }
        if (error instanceof PbootAuthorizationError)
          return NextResponse.json(
            { error: { code: error.code, message: error.message } },
            {
              status: error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_CODE' ? 400 : 409,
            },
          );
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '授权配置失败' } },
          { status: 500 },
        );
      }
    },
  );
}
