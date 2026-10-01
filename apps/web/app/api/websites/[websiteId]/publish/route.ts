import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { AuthorizationError, assertSameOrigin, requireWebsiteAccess } from '@cloudcrane/auth';
import {
  finishAuditEvent,
  insertAuditEvent,
  operation,
  productionRuntime,
  website,
  websiteRelease,
  workspace,
} from '@cloudcrane/db';
import {
  ProductionClient,
  ProductionClientError,
  WorkspaceClient,
} from '@cloudcrane/workspace-client';
import { createLogger, getActiveTraceContext } from '@cloudcrane/shared';
import { auth, authDb } from '../../../../../lib/server/auth.js';
import { withWebRequestContext } from '../../../../../lib/server/observability.js';
import {
  claimWebsitePublishOperation,
  finishWebsitePublishOperation,
  WebsiteOperationIdempotencyError,
  websitePublishRequestHash,
} from '../../../../../lib/server/billing-operations.js';
import {
  productionUrlForSlug,
  publishWebsite,
  WebsitePublishError,
} from '../../../../../lib/server/website-publishing.js';

export const runtime = 'nodejs';

const logger = createLogger('web.api.website-publish');

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(request, 'POST /api/websites/:websiteId/publish', async () => {
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

    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255)
      return NextResponse.json(
        { error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: '请求缺少有效的幂等键' } },
        { status: 400 },
      );

    const ownerFilter = access.isAdmin
      ? eq(website.id as never, websiteId)
      : and(
          eq(website.id as never, websiteId),
          eq(website.ownerId as never, access.session.user.id),
        );
    const [billing] = await authDb
      .select({ billingAccountId: website.billingAccountId })
      .from(website)
      .where(ownerFilter as never)
      .limit(1);
    if (!billing?.billingAccountId)
      return NextResponse.json(
        { error: { code: 'WEBSITE_NOT_FOUND', message: '网站不存在' } },
        { status: 404 },
      );

    const claim = await claimWebsitePublishOperation({
      db: authDb,
      billingAccountId: billing.billingAccountId,
      websiteId,
      idempotencyKey,
      requestHash: websitePublishRequestHash(websiteId),
      requestId: request.headers.get('x-request-id') ?? undefined,
    }).catch((error: unknown) => {
      if (error instanceof WebsiteOperationIdempotencyError) return error;
      throw error;
    });
    if (claim instanceof WebsiteOperationIdempotencyError)
      return NextResponse.json(
        { error: { code: claim.code, message: '幂等键已用于其他发布参数' } },
        { status: 409 },
      );
    if (claim.kind === 'pending')
      return NextResponse.json(
        { status: 'processing', operationId: claim.operationId },
        { status: 202 },
      );
    if (claim.kind === 'failed')
      return NextResponse.json(
        {
          error: {
            code: claim.errorCode ?? 'PUBLISH_FAILED',
            message: '此前的发布请求失败，请使用新的幂等键重试',
          },
        },
        { status: 409 },
      );
    if (claim.kind === 'replay') {
      const [release] = await authDb
        .select({
          id: websiteRelease.id,
          sequence: websiteRelease.sequence,
          status: websiteRelease.status,
        })
        .from(websiteRelease)
        .where(eq(websiteRelease.id as never, claim.releaseId) as never)
        .limit(1);
      const [production] = await authDb
        .select({
          id: productionRuntime.id,
          status: productionRuntime.status,
          productionSlug: productionRuntime.productionSlug,
        })
        .from(productionRuntime)
        .where(eq(productionRuntime.websiteId as never, websiteId) as never)
        .limit(1);
      if (!release || !production)
        return NextResponse.json(
          { error: { code: 'OPERATION_RESULT_MISSING', message: '发布结果暂不可用，请稍后重试' } },
          { status: 503 },
        );
      return NextResponse.json({
        release,
        production,
        productionUrl: productionUrlForSlug(production.productionSlug),
        requiresAuthorization: production.status === 'authorization_required',
      });
    }

    const startedAt = Date.now();
    const publishHeartbeat = setInterval(() => {
      void authDb
        .update(operation)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(operation.id as never, claim.operationId),
            eq(operation.status as never, 'running'),
          ) as never,
        )
        .catch(() => undefined);
    }, 60_000);
    publishHeartbeat.unref?.();
    let auditId: string | undefined;
    let releaseId: string | undefined;
    try {
      const [workspaceRow] = await authDb
        .select({ id: workspace.id, status: workspace.status })
        .from(workspace)
        .innerJoin(website, eq(workspace.websiteId as never, website.id as never) as never)
        .where(ownerFilter as never)
        .limit(1);
      if (!workspaceRow || !['running', 'stopped'].includes(workspaceRow.status))
        throw new WebsitePublishError('WEBSITE_NOT_READY', '网站工作区尚未准备好');

      const context = {
        websiteId,
        workspaceId: workspaceRow.id,
        traceId: getActiveTraceContext().traceId,
      };
      const endpoint = process.env.WORKSPACE_GATEWAY_ENDPOINT;
      const token = process.env.WORKSPACE_GATEWAY_CLIENT_TOKEN;
      if (!endpoint || !token)
        throw new WebsitePublishError('RELEASE_PREFLIGHT_FAILED', '发布服务当前不可用');
      auditId = await insertAuditEvent(authDb, {
        actorType: access.isAdmin ? 'admin' : 'user',
        actorUserId: access.session.user.id,
        websiteId,
        workspaceId: workspaceRow.id,
        operation: 'website.publish',
        resourceType: 'website',
        requestId: request.headers.get('x-request-id') ?? undefined,
        ...getActiveTraceContext(),
        status: 'PENDING',
        idempotencyKey,
        requestSummary: { websiteId, workspaceId: workspaceRow.id },
      });

      const result = await publishWebsite({
        db: authDb,
        websiteId,
        ownerId: access.isAdmin ? null : access.session.user.id,
        operationId: claim.operationId,
        client: new ProductionClient(endpoint, token, context),
        workspaceClient: new WorkspaceClient(endpoint, token, context),
      });
      releaseId = result.release.id;
      await finishWebsitePublishOperation({
        db: authDb,
        operationId: claim.operationId,
        status: 'succeeded',
        websiteId,
        releaseId,
      }).catch(() => {
        logger.error(
          {
            event: 'billing.operation.finalization.failed',
            operation: 'website.publish',
            websiteId,
          },
          'website publish succeeded but operation finalization failed',
        );
      });
      await finishAuditEvent(authDb, auditId, {
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        resultSummary: {
          websiteId,
          releaseId: result.release.id,
          status: result.production.status,
        },
      }).catch(() => {
        logger.error(
          { event: 'audit.finalization.failed', operation: 'website.publish', websiteId },
          'website publish succeeded but audit finalization failed',
        );
      });
      clearInterval(publishHeartbeat);
      return NextResponse.json(result);
    } catch (error) {
      clearInterval(publishHeartbeat);
      const isUnknown = error instanceof WebsitePublishError && error.unknownResult;
      const code =
        error instanceof WebsitePublishError
          ? error.code
          : error instanceof ProductionClientError
            ? error.code
            : 'PUBLISH_FAILED';
      if (!isUnknown) {
        await finishWebsitePublishOperation({
          db: authDb,
          operationId: claim.operationId,
          status: 'failed',
          websiteId,
          ...(releaseId ? { releaseId } : {}),
          errorCode: code,
          errorMessage: error instanceof Error ? error.message : 'website publish failed',
        }).catch(() => undefined);
        await authDb
          .update(websiteRelease)
          .set({ status: 'failed', errorCode: code, errorMessage: '发布未能完成' })
          .where(eq(websiteRelease.id as never, claim.operationId) as never)
          .catch(() => undefined);
        await authDb
          .update(productionRuntime)
          .set({
            status: 'failed',
            lastErrorCode: code.slice(0, 64),
            lastErrorMessage: 'Production 首次发布未能完成',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productionRuntime.websiteId as never, websiteId),
              isNull(productionRuntime.currentReleaseId as never),
              eq(productionRuntime.status as never, 'provisioning'),
            ) as never,
          )
          .catch(() => undefined);
      }
      if (auditId) {
        await finishAuditEvent(authDb, auditId, {
          status: isUnknown ? 'UNKNOWN' : 'FAILED',
          durationMs: Date.now() - startedAt,
          errorCode: code,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        }).catch(() => undefined);
      }
      if (error instanceof WebsitePublishError)
        return NextResponse.json(
          {
            ...(isUnknown ? { status: 'processing', operationId: claim.operationId } : {}),
            error: { code, message: error.message },
          },
          { status: isUnknown ? 202 : statusForPublishError(code) },
        );
      logger.error(
        {
          event: 'website.publish.failed',
          websiteId,
          operationId: claim.operationId,
          errorCode: code,
        },
        'website publish failed',
      );
      return NextResponse.json(
        { error: { code, message: '发布网站失败' } },
        { status: statusForPublishError(code) },
      );
    }
  });
}

function statusForPublishError(code: string): number {
  if (code === 'WEBSITE_NOT_READY') return 409;
  if (code === 'WEBSITE_BUSY' || code === 'PUBLISH_ALREADY_RUNNING') return 409;
  if (code === 'PRODUCTION_NOT_ENTITLED' || code === 'PRODUCTION_QUOTA_EXCEEDED') return 403;
  if (code === 'ENTITLEMENT_UNAVAILABLE') return 503;
  if (code === 'PRODUCTION_INGRESS_NOT_CONFIGURED') return 503;
  return 502;
}
