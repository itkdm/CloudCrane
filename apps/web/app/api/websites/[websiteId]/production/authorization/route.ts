import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { assertSameOrigin, AuthorizationError, requireWebsiteAccess } from '@cloudcrane/auth';
import { finishAuditEvent, insertAuditEvent, productionRuntime, workspace } from '@cloudcrane/db';
import { ProductionClient } from '@cloudcrane/workspace-client';
import { getActiveTraceContext } from '@cloudcrane/shared';
import { auth, authDb } from '../../../../../../lib/server/auth.js';
import { withWebRequestContext } from '../../../../../../lib/server/observability.js';
import {
  normalizePbootAuthorization,
  PbootAuthorizationError,
} from '../../../../../../lib/server/pboot-authorization.js';
import { productionUrlForSlug } from '../../../../../../lib/server/website-publishing.js';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(
    request,
    'POST /api/websites/:websiteId/production/authorization',
    async () => {
      const { websiteId } = await params;
      const idempotencyKey = request.headers.get('idempotency-key')?.trim();
      if (!idempotencyKey || idempotencyKey.length > 255)
        return NextResponse.json(
          { error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: '请求缺少有效的幂等键' } },
          { status: 400 },
        );
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

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return NextResponse.json(
          { error: { code: 'INVALID_CODE', message: '请求内容无效' } },
          { status: 400 },
        );
      }
      let authorizationCode: string;
      try {
        authorizationCode = normalizePbootAuthorization(
          payload && typeof payload === 'object'
            ? (payload as { authorizationCode?: unknown }).authorizationCode
            : undefined,
        );
      } catch (error) {
        if (error instanceof PbootAuthorizationError)
          return NextResponse.json(
            { error: { code: error.code, message: error.message } },
            { status: 400 },
          );
        throw error;
      }

      const ownerCondition = eq(productionRuntime.websiteId as never, websiteId);
      const [runtimeRow] = await authDb
        .select({
          id: productionRuntime.id,
          status: productionRuntime.status,
          productionSlug: productionRuntime.productionSlug,
        })
        .from(productionRuntime)
        .where(ownerCondition as never)
        .limit(1);
      if (!runtimeRow)
        return NextResponse.json(
          { error: { code: 'PRODUCTION_NOT_FOUND', message: 'Production 网站尚未创建' } },
          { status: 404 },
        );
      if (runtimeRow.status !== 'authorization_required')
        return NextResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Production 当前不需要授权' } },
          { status: 409 },
        );
      const productionUrl = productionUrlForSlug(runtimeRow.productionSlug);
      const [workspaceRow] = await authDb
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.websiteId as never, websiteId) as never)
        .limit(1);
      if (!workspaceRow)
        return NextResponse.json(
          { error: { code: 'WORKSPACE_NOT_FOUND', message: '网站工作区不存在' } },
          { status: 404 },
        );

      const endpoint = process.env.WORKSPACE_GATEWAY_ENDPOINT;
      const token = process.env.WORKSPACE_GATEWAY_CLIENT_TOKEN;
      if (!endpoint || !token)
        return NextResponse.json(
          { error: { code: 'PRODUCTION_UNAVAILABLE', message: '授权服务暂不可用' } },
          { status: 503 },
        );
      const startedAt = Date.now();
      const trace = getActiveTraceContext();
      let auditId: string;
      try {
        auditId = await insertAuditEvent(authDb, {
          actorType: access.isAdmin ? 'admin' : 'user',
          actorUserId: access.session.user.id,
          websiteId,
          workspaceId: workspaceRow.id,
          operation: 'production.authorization',
          resourceType: 'production_runtime',
          requestId: request.headers.get('x-request-id') ?? undefined,
          ...trace,
          status: 'PENDING',
          requestSummary: { websiteId, workspaceId: workspaceRow.id, provided: true },
        });
      } catch {
        return NextResponse.json(
          { error: { code: 'AUDIT_UNAVAILABLE', message: '审计服务暂不可用，请稍后重试' } },
          { status: 503 },
        );
      }
      try {
        const result = await new ProductionClient(endpoint, token, {
          websiteId,
          workspaceId: workspaceRow.id,
          traceId: trace.traceId,
        }).authorize(
          { productionSlug: runtimeRow.productionSlug, authorizationCode },
          {
            idempotencyKey: `production-authorize-${runtimeRow.id}-${idempotencyKey}`,
            deadlineMs: 60_000,
          },
        );
        await authDb
          .update(productionRuntime)
          .set({
            status: result.status,
            updatedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null,
          })
          .where(eq(productionRuntime.id as never, runtimeRow.id) as never);
        await finishAuditEvent(authDb, auditId, {
          status: 'SUCCESS',
          durationMs: Date.now() - startedAt,
          resultSummary: { status: result.status },
        }).catch(() => undefined);
        return NextResponse.json({ status: result.status, productionUrl });
      } catch (error) {
        const unknown =
          error instanceof Error && 'code' in error && error.code === 'UNKNOWN_RESULT';
        if (!unknown)
          await authDb
            .update(productionRuntime)
            .set({ status: 'authorization_required', updatedAt: new Date() })
            .where(eq(productionRuntime.id as never, runtimeRow.id) as never)
            .catch(() => undefined);
        await finishAuditEvent(authDb, auditId, {
          status: unknown ? 'UNKNOWN' : 'FAILED',
          durationMs: Date.now() - startedAt,
          errorCode: unknown ? 'UNKNOWN_RESULT' : 'PRODUCTION_AUTHORIZATION_FAILED',
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        }).catch(() => undefined);
        return NextResponse.json(
          {
            ...(unknown ? { status: 'processing' } : {}),
            error: {
              code: unknown ? 'UNKNOWN_RESULT' : 'PRODUCTION_AUTHORIZATION_FAILED',
              message: unknown
                ? '授权结果正在确认中，请稍后刷新'
                : 'Production 授权失败，请检查授权码和正式域名',
            },
          },
          { status: unknown ? 202 : 502 },
        );
      }
    },
  );
}
