import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { AuthorizationError, assertSameOrigin, requireWebsiteAccess } from '@cloudcrane/auth';
import {
  agentRun,
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
import { auth, authDb } from '../../../../../../lib/server/auth.js';
import { withWebRequestContext } from '../../../../../../lib/server/observability.js';

export const runtime = 'nodejs';

const logger = createLogger('web.api.production-refresh');
const operationType = 'website.production.refresh';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(
    request,
    'POST /api/websites/:websiteId/production/refresh',
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

      const idempotencyKey = request.headers.get('idempotency-key')?.trim();
      if (!idempotencyKey || idempotencyKey.length > 255)
        return NextResponse.json(
          { error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: '请求缺少有效的幂等键' } },
          { status: 400 },
        );

      const requestHash = createHash('sha256').update(JSON.stringify({ websiteId })).digest('hex');
      const ownerFilter = access.isAdmin
        ? eq(website.id as never, websiteId)
        : and(
            eq(website.id as never, websiteId),
            eq(website.ownerId as never, access.session.user.id),
          );
      const claim = await authDb.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`website-lifecycle:${websiteId}`}))` as never,
        );
        const [site] = await tx
          .select({
            id: website.id,
            status: website.status,
            cmsType: website.cmsType,
            billingAccountId: website.billingAccountId,
          })
          .from(website)
          .where(ownerFilter as never)
          .for('update');
        if (
          !site ||
          site.status !== 'ready' ||
          site.cmsType !== 'pbootcms' ||
          !site.billingAccountId
        )
          return { error: 'WEBSITE_NOT_READY' as const };

        const [existing] = await tx
          .select({
            id: operation.id,
            status: operation.status,
            requestHash: operation.requestHash,
            errorCode: operation.errorCode,
            metadata: operation.metadata,
            updatedAt: operation.updatedAt,
          })
          .from(operation)
          .where(
            and(
              eq(operation.billingAccountId as never, site.billingAccountId),
              eq(operation.type as never, operationType),
              eq(operation.idempotencyKey as never, idempotencyKey),
            ) as never,
          )
          .limit(1);
        if (existing) {
          if (existing.requestHash !== requestHash)
            return { error: 'IDEMPOTENCY_KEY_REUSED' as const };
          if (existing.status === 'succeeded') return { replay: existing };
          if (existing.status === 'failed') return { failed: existing };
          if (
            ['pending', 'running', 'retryable'].includes(existing.status) &&
            existing.updatedAt.getTime() < Date.now() - 10 * 60 * 1000
          ) {
            const [resumeWorkspace] = await tx
              .select({ id: workspace.id, status: workspace.status, runnerId: workspace.runnerId })
              .from(workspace)
              .where(eq(workspace.websiteId as never, websiteId) as never)
              .limit(1);
            const [resumeProduction] = await tx
              .select({
                status: productionRuntime.status,
                productionSlug: productionRuntime.productionSlug,
              })
              .from(productionRuntime)
              .where(eq(productionRuntime.websiteId as never, websiteId) as never)
              .limit(1);
            if (
              !resumeWorkspace ||
              !['running', 'stopped'].includes(resumeWorkspace.status) ||
              !resumeWorkspace.runnerId
            )
              return { error: 'WORKSPACE_UNAVAILABLE' as const };
            if (!resumeProduction || resumeProduction.status !== 'active')
              return { error: 'PRODUCTION_NOT_ACTIVE' as const };
            await tx
              .update(operation)
              .set({
                status: 'running',
                startedAt: new Date(),
                updatedAt: new Date(),
                retryCount: sql`${operation.retryCount} + 1` as never,
              })
              .where(eq(operation.id as never, existing.id) as never);
            return {
              claimed: {
                operationId: existing.id,
                workspaceId: resumeWorkspace.id,
                productionSlug: resumeProduction.productionSlug,
              },
            };
          }
          return { pending: existing };
        }

        const [workspaceRow] = await tx
          .select({ id: workspace.id, status: workspace.status, runnerId: workspace.runnerId })
          .from(workspace)
          .where(eq(workspace.websiteId as never, websiteId) as never)
          .limit(1);
        const [production] = await tx
          .select({
            status: productionRuntime.status,
            productionSlug: productionRuntime.productionSlug,
          })
          .from(productionRuntime)
          .where(eq(productionRuntime.websiteId as never, websiteId) as never)
          .limit(1);
        if (
          !workspaceRow ||
          !['running', 'stopped'].includes(workspaceRow.status) ||
          !workspaceRow.runnerId
        )
          return { error: 'WORKSPACE_UNAVAILABLE' as const };
        if (!production || production.status !== 'active')
          return { error: 'PRODUCTION_NOT_ACTIVE' as const };

        const activeRuns = await tx
          .select({ id: agentRun.id })
          .from(agentRun)
          .where(
            and(
              eq(agentRun.websiteId as never, websiteId),
              inArray(agentRun.status as never, ['PENDING', 'RUNNING']),
            ) as never,
          )
          .limit(1);
        if (activeRuns.length) return { error: 'WEBSITE_BUSY' as const };
        const activePublishes = await tx
          .select({ id: operation.id })
          .from(operation)
          .where(
            and(
              eq(operation.websiteId as never, websiteId),
              eq(operation.type as never, 'website.publish'),
              inArray(operation.status as never, ['pending', 'running', 'retryable']),
            ) as never,
          )
          .limit(1);
        const activeRefreshes = await tx
          .select({ id: operation.id })
          .from(operation)
          .where(
            and(
              eq(operation.websiteId as never, websiteId),
              eq(operation.type as never, operationType),
              inArray(operation.status as never, ['pending', 'running', 'retryable']),
            ) as never,
          )
          .limit(1);
        const activeReleases = await tx
          .select({ id: websiteRelease.id })
          .from(websiteRelease)
          .where(
            and(
              eq(websiteRelease.websiteId as never, websiteId),
              inArray(websiteRelease.status as never, ['preparing', 'staged', 'activating']),
            ) as never,
          )
          .limit(1);
        if (activePublishes.length || activeRefreshes.length || activeReleases.length)
          return { error: 'WEBSITE_BUSY' as const };

        const [created] = await tx
          .insert(operation)
          .values({
            billingAccountId: site.billingAccountId,
            websiteId,
            type: operationType,
            status: 'running',
            idempotencyKey,
            requestHash,
            requestId: request.headers.get('x-request-id') ?? undefined,
            startedAt: new Date(),
          })
          .returning({ id: operation.id });
        if (!created) throw new Error('Production refresh operation was not created');
        return {
          claimed: {
            operationId: created.id,
            workspaceId: workspaceRow.id,
            productionSlug: production.productionSlug,
          },
        };
      });

      if ('error' in claim) {
        const status =
          claim.error === 'WEBSITE_NOT_READY'
            ? 409
            : claim.error === 'IDEMPOTENCY_KEY_REUSED'
              ? 409
              : claim.error === 'WEBSITE_BUSY'
                ? 409
                : 503;
        const message =
          claim.error === 'WEBSITE_BUSY'
            ? 'Agent 或发布任务正在修改网站，请等待后再刷新'
            : claim.error === 'PRODUCTION_NOT_ACTIVE'
              ? '正式网站当前不可用'
              : claim.error === 'IDEMPOTENCY_KEY_REUSED'
                ? '幂等键已用于其他刷新请求'
                : '工作区或正式网站尚未准备好';
        return NextResponse.json({ error: { code: claim.error, message } }, { status });
      }
      if ('pending' in claim && claim.pending)
        return NextResponse.json(
          { status: 'processing', operationId: claim.pending.id },
          { status: 202 },
        );
      if ('failed' in claim && claim.failed)
        return NextResponse.json(
          {
            error: {
              code: claim.failed.errorCode ?? 'REFRESH_FAILED',
              message: '此前的刷新失败，请重新发起刷新',
            },
          },
          { status: 409 },
        );
      if ('replay' in claim && claim.replay)
        return NextResponse.json({
          status: 'succeeded',
          result: claim.replay.metadata.refreshResult ?? null,
        });

      const { operationId, workspaceId, productionSlug } = claim.claimed;
      const startedAt = Date.now();
      let auditId: string | undefined;
      const heartbeat = setInterval(() => {
        void authDb
          .update(operation)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(operation.id as never, operationId),
              eq(operation.status as never, 'running'),
            ) as never,
          )
          .catch(() => undefined);
      }, 60_000);
      heartbeat.unref?.();
      try {
        auditId = await insertAuditEvent(authDb, {
          actorType: access.isAdmin ? 'admin' : 'user',
          actorUserId: access.session.user.id,
          websiteId,
          workspaceId,
          operation: operationType,
          resourceType: 'website',
          resourceRef: websiteId,
          requestId: request.headers.get('x-request-id') ?? undefined,
          ...getActiveTraceContext(),
          status: 'RUNNING',
          idempotencyKey,
          requestSummary: { source: 'production', destination: 'workspace' },
        });
        const endpoint = process.env.WORKSPACE_GATEWAY_ENDPOINT;
        const token = process.env.WORKSPACE_GATEWAY_CLIENT_TOKEN;
        if (!endpoint || !token) throw new Error('REFRESH_SERVICE_UNAVAILABLE');
        const result = await new ProductionClient(endpoint, token, {
          websiteId,
          workspaceId,
          traceId: getActiveTraceContext().traceId,
        }).refreshContent(
          { productionSlug, refreshId: operationId },
          { deadlineMs: 300_000, idempotencyKey: `production-refresh-${operationId}` },
        );
        let previewSynchronized = false;
        try {
          const runtime = await new WorkspaceClient(endpoint, token, {
            websiteId,
            workspaceId,
            traceId: getActiveTraceContext().traceId,
          }).runtime.status();
          previewSynchronized = runtime.status === 'running';
        } catch (error) {
          logger.warn(
            {
              event: 'website.production-refresh.preview-sync.failed',
              websiteId,
              workspaceId,
              operationId,
              errorType: error instanceof Error ? error.constructor.name : typeof error,
            },
            'Workspace Preview runtime metadata could not be synchronized after Production refresh',
          );
        }
        if (!previewSynchronized)
          logger.warn(
            {
              event: 'website.production-refresh.preview-sync.unavailable',
              websiteId,
              workspaceId,
              operationId,
            },
            'Workspace Preview runtime is not running after Production refresh',
          );
        await authDb
          .update(operation)
          .set({
            status: 'succeeded',
            resultResourceId: websiteId,
            metadata: { refreshResult: result, previewSynchronized },
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(operation.id as never, operationId) as never);
        await finishAuditEvent(authDb, auditId, {
          status: 'SUCCESS',
          durationMs: Date.now() - startedAt,
          resultSummary: result,
        });
        return NextResponse.json({ status: 'succeeded', result, previewSynchronized });
      } catch (error) {
        const unknownResult =
          error instanceof ProductionClientError && error.code === 'UNKNOWN_RESULT';
        if (!unknownResult) {
          await authDb
            .update(operation)
            .set({
              status: 'failed',
              errorCode: error instanceof ProductionClientError ? error.code : 'REFRESH_FAILED',
              errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Refresh failed',
              finishedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(operation.id as never, operationId) as never);
        }
        if (auditId)
          await finishAuditEvent(authDb, auditId, {
            status: unknownResult ? 'UNKNOWN' : 'FAILED',
            durationMs: Date.now() - startedAt,
            errorCode: error instanceof ProductionClientError ? error.code : 'REFRESH_FAILED',
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          }).catch(() => undefined);
        logger.error(
          {
            event: 'website.production-refresh.failed',
            websiteId,
            workspaceId,
            operationId,
            unknownResult,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          },
          'Production content refresh failed',
        );
        return NextResponse.json(
          {
            status: unknownResult ? 'processing' : 'failed',
            operationId,
            ...(unknownResult
              ? {}
              : {
                  error: {
                    code: error instanceof ProductionClientError ? error.code : 'REFRESH_FAILED',
                    message:
                      error instanceof ProductionClientError &&
                      error.code === 'WORKSPACE_SCHEMA_MISMATCH'
                        ? '正式网站与工作区的数据库结构不同。请先同步代码或迁移数据库，再刷新内容。'
                        : '从正式网站刷新失败，请检查状态后重试',
                  },
                }),
          },
          { status: unknownResult ? 202 : 502 },
        );
      } finally {
        clearInterval(heartbeat);
      }
    },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(
    request,
    'GET /api/websites/:websiteId/production/refresh',
    async () => {
      const { websiteId } = await params;
      try {
        const access = await requireWebsiteAccess(authDb, auth, request.headers, websiteId);
        const [row] = await authDb
          .select({
            id: operation.id,
            status: operation.status,
            metadata: operation.metadata,
            errorCode: operation.errorCode,
          })
          .from(operation)
          .where(
            and(
              eq(operation.websiteId as never, websiteId),
              eq(operation.type as never, operationType),
            ) as never,
          )
          .orderBy(sql`${operation.createdAt} desc` as never)
          .limit(1);
        if (!row) return NextResponse.json({ status: 'idle' });
        if (!access.isAdmin) {
          const [owned] = await authDb
            .select({ id: website.id })
            .from(website)
            .where(
              and(
                eq(website.id as never, websiteId),
                eq(website.ownerId as never, access.session.user.id),
              ) as never,
            )
            .limit(1);
          if (!owned)
            return NextResponse.json(
              { error: { code: 'WEBSITE_NOT_FOUND', message: '网站不存在' } },
              { status: 404 },
            );
        }
        return NextResponse.json({
          operationId: row.id,
          status: row.status,
          result: row.metadata.refreshResult ?? null,
          previewSynchronized: row.metadata.previewSynchronized ?? null,
          errorCode: row.errorCode,
        });
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
    },
  );
}
