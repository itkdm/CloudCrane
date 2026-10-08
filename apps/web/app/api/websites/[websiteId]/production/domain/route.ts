import { and, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { AuthorizationError, assertSameOrigin, requireWebsiteAccess } from '@cloudcrane/auth';
import {
  finishAuditEvent,
  insertAuditEvent,
  operation,
  productionDomain,
  productionRuntime,
  website,
  websiteRelease,
  workspace,
} from '@cloudcrane/db';
import { normalizeProductionSlug } from '@cloudcrane/shared';
import { auth, authDb } from '../../../../../../lib/server/auth.js';
import { withWebRequestContext } from '../../../../../../lib/server/observability.js';
import { productionUrlForSlug } from '../../../../../../lib/server/website-publishing.js';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(
    request,
    'GET /api/websites/:websiteId/production/domain',
    async () => {
      const { websiteId } = await params;
      try {
        await requireWebsiteAccess(authDb, auth, request.headers, websiteId);
        const rawSlug = new URL(request.url).searchParams.get('slug') ?? '';
        const normalized = normalizeProductionSlug(rawSlug);
        if (!normalized.valid)
          return NextResponse.json({ available: false, reason: normalized.reason });
        const [claim] = await authDb
          .select({
            slug: productionDomain.slug,
            productionRuntimeId: productionDomain.productionRuntimeId,
            routeType: productionDomain.routeType,
          })
          .from(productionDomain)
          .where(eq(productionDomain.slug as never, normalized.slug) as never)
          .limit(1);
        const [runtime] = await authDb
          .select({ id: productionRuntime.id })
          .from(productionRuntime)
          .where(eq(productionRuntime.websiteId as never, websiteId) as never)
          .limit(1);
        const available =
          !claim ||
          (claim.productionRuntimeId === runtime?.id &&
            claim.routeType === 'canonical' &&
            claim.slug === normalized.slug);
        return NextResponse.json({
          available,
          slug: normalized.slug,
          url: productionUrlForSlug(normalized.slug),
        });
      } catch (error) {
        if (error instanceof AuthorizationError)
          return NextResponse.json(
            { error: { code: error.code, message: error.message } },
            { status: error.status },
          );
        return NextResponse.json(
          { error: { code: 'PRODUCTION_DOMAIN_CHECK_FAILED', message: '网址可用性暂时无法确认' } },
          { status: 503 },
        );
      }
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(
    request,
    'PATCH /api/websites/:websiteId/production/domain',
    async () => {
      const { websiteId } = await params;
      try {
        assertSameOrigin(request.headers);
        const access = await requireWebsiteAccess(authDb, auth, request.headers, websiteId);
        let body: { slug?: unknown };
        try {
          body = (await request.json()) as { slug?: unknown };
        } catch {
          return NextResponse.json(
            { error: { code: 'PRODUCTION_DOMAIN_INVALID', message: '请求内容无效' } },
            { status: 400 },
          );
        }
        const normalized =
          typeof body.slug === 'string' ? normalizeProductionSlug(body.slug) : null;
        if (!normalized?.valid)
          return NextResponse.json(
            {
              error: {
                code: 'PRODUCTION_DOMAIN_INVALID',
                message: '网址前缀格式无效或为平台保留名称',
              },
            },
            { status: 400 },
          );

        const ownerFilter = access.isAdmin
          ? eq(website.id as never, websiteId)
          : and(
              eq(website.id as never, websiteId),
              eq(website.ownerId as never, access.session.user.id),
            );
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

        const auditId = await insertAuditEvent(authDb, {
          actorType: access.isAdmin ? 'admin' : 'user',
          actorUserId: access.session.user.id,
          websiteId,
          workspaceId: workspaceRow.id,
          operation: 'production.domain.change',
          resourceType: 'production_runtime',
          requestId: request.headers.get('x-request-id') ?? undefined,
          status: 'PENDING',
          requestSummary: { websiteId, requestedSlug: normalized.slug },
        }).catch(() => null);
        if (!auditId)
          return NextResponse.json(
            { error: { code: 'AUDIT_UNAVAILABLE', message: '审计服务暂不可用，请稍后重试' } },
            { status: 503 },
          );

        const startedAt = Date.now();
        try {
          const result = await authDb.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`website-lifecycle:${websiteId}`}))` as never,
            );
            const [site] = await tx
              .select({ id: website.id })
              .from(website)
              .where(ownerFilter as never)
              .limit(1);
            if (!site) throw new DomainChangeError('WEBSITE_NOT_FOUND', '网站不存在', 404);
            const [runtime] = await tx
              .select({
                id: productionRuntime.id,
                status: productionRuntime.status,
                productionSlug: productionRuntime.productionSlug,
                currentReleaseId: productionRuntime.currentReleaseId,
              })
              .from(productionRuntime)
              .where(eq(productionRuntime.websiteId as never, websiteId) as never)
              .for('update')
              .limit(1);
            if (!runtime)
              throw new DomainChangeError('PRODUCTION_NOT_FOUND', 'Production 网站尚未创建', 409);
            const alreadyPublished = runtime.currentReleaseId !== null;
            const editableStatuses = alreadyPublished
              ? ['active', 'authorization_required', 'stopped']
              : ['provisioning', 'failed'];
            if (!editableStatuses.includes(runtime.status))
              throw new DomainChangeError(
                'PRODUCTION_BUSY',
                '正式网站当前正在变更，暂时不能修改网址',
                409,
              );
            if (runtime.productionSlug === normalized.slug)
              return { slug: normalized.slug, changed: false };

            const [inFlightRelease] = await tx
              .select({ id: websiteRelease.id })
              .from(websiteRelease)
              .where(
                and(
                  eq(websiteRelease.websiteId as never, websiteId),
                  inArray(websiteRelease.status as never, ['preparing', 'staged', 'activating']),
                ) as never,
              )
              .limit(1);
            const [inFlightOperation] = await tx
              .select({ id: operation.id })
              .from(operation)
              .where(
                and(
                  eq(operation.websiteId as never, websiteId),
                  eq(operation.type as never, 'website.production.refresh'),
                  inArray(operation.status as never, ['pending', 'running', 'retryable']),
                ) as never,
              )
              .limit(1);
            if (inFlightRelease || inFlightOperation)
              throw new DomainChangeError(
                'PRODUCTION_BUSY',
                '请等待当前发布或刷新操作完成后再修改网址',
                409,
              );

            const [existingClaim] = await tx
              .select({
                id: productionDomain.id,
                productionRuntimeId: productionDomain.productionRuntimeId,
              })
              .from(productionDomain)
              .where(eq(productionDomain.slug as never, normalized.slug) as never)
              .limit(1);
            if (existingClaim && existingClaim.productionRuntimeId !== runtime.id)
              throw new DomainChangeError('PRODUCTION_DOMAIN_TAKEN', '这个网址前缀已被使用', 409);
            if (existingClaim)
              throw new DomainChangeError(
                'PRODUCTION_DOMAIN_TAKEN',
                '这个网址前缀已作为历史地址保留',
                409,
              );

            const [currentCanonical] = await tx
              .select({ id: productionDomain.id })
              .from(productionDomain)
              .where(
                and(
                  eq(productionDomain.productionRuntimeId as never, runtime.id),
                  eq(productionDomain.slug as never, runtime.productionSlug),
                  eq(productionDomain.routeType as never, 'canonical'),
                ) as never,
              )
              .for('update')
              .limit(1);
            if (!currentCanonical)
              throw new DomainChangeError(
                'PRODUCTION_DOMAIN_STATE_INVALID',
                '正式网址记录不完整，请联系支持人员',
                409,
              );

            if (alreadyPublished) {
              await tx
                .update(productionDomain)
                .set({ routeType: 'redirect' })
                .where(
                  and(
                    eq(productionDomain.productionRuntimeId as never, runtime.id),
                    eq(productionDomain.slug as never, runtime.productionSlug),
                  ) as never,
                );
              await tx.insert(productionDomain).values({
                productionRuntimeId: runtime.id,
                slug: normalized.slug,
                routeType: 'canonical',
              });
            } else {
              await tx
                .update(productionDomain)
                .set({ slug: normalized.slug })
                .where(
                  and(
                    eq(productionDomain.productionRuntimeId as never, runtime.id),
                    eq(productionDomain.slug as never, runtime.productionSlug),
                    eq(productionDomain.routeType as never, 'canonical'),
                  ) as never,
                );
            }
            await tx
              .update(productionRuntime)
              .set({
                productionSlug: normalized.slug,
                status: alreadyPublished ? 'authorization_required' : 'provisioning',
                updatedAt: new Date(),
                lastErrorCode: null,
                lastErrorMessage: null,
              })
              .where(eq(productionRuntime.id as never, runtime.id) as never);
            return { slug: normalized.slug, changed: true };
          });
          await finishAuditEvent(authDb, auditId, {
            status: 'SUCCESS',
            durationMs: Date.now() - startedAt,
            resultSummary: { websiteId, slug: result.slug, changed: result.changed },
          }).catch(() => undefined);
          return NextResponse.json({ ...result, url: productionUrlForSlug(result.slug) });
        } catch (error) {
          const domainError = error instanceof DomainChangeError ? error : null;
          const uniqueConflict = isUniqueViolation(error);
          await finishAuditEvent(authDb, auditId, {
            status: 'FAILED',
            durationMs: Date.now() - startedAt,
            errorCode:
              domainError?.code ??
              (uniqueConflict ? 'PRODUCTION_DOMAIN_TAKEN' : 'PRODUCTION_DOMAIN_CHANGE_FAILED'),
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          }).catch(() => undefined);
          if (domainError)
            return NextResponse.json(
              { error: { code: domainError.code, message: domainError.message } },
              { status: domainError.status },
            );
          if (uniqueConflict)
            return NextResponse.json(
              { error: { code: 'PRODUCTION_DOMAIN_TAKEN', message: '这个网址前缀已被使用' } },
              { status: 409 },
            );
          throw error;
        }
      } catch (error) {
        if (error instanceof AuthorizationError)
          return NextResponse.json(
            { error: { code: error.code, message: error.message } },
            { status: error.status },
          );
        return NextResponse.json(
          {
            error: {
              code: 'PRODUCTION_DOMAIN_CHANGE_FAILED',
              message: '修改正式网址失败，请稍后重试',
            },
          },
          { status: 500 },
        );
      }
    },
  );
}

class DomainChangeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
