import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { AuthorizationError, requireWebsiteAccess } from '@cloudcrane/auth';
import { operation, productionRuntime, websiteRelease, workspace } from '@cloudcrane/db';
import { ProductionClient } from '@cloudcrane/workspace-client';
import { auth, authDb } from '../../../../../lib/server/auth.js';
import { withWebRequestContext } from '../../../../../lib/server/observability.js';
import { productionUrlForSlug } from '../../../../../lib/server/website-publishing.js';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(request, 'GET /api/websites/:websiteId/production', async () => {
    const { websiteId } = await params;
    try {
      await requireWebsiteAccess(authDb, auth, request.headers, websiteId);
      const [current] = await authDb
        .select({
          id: productionRuntime.id,
          status: productionRuntime.status,
          productionSlug: productionRuntime.productionSlug,
          currentReleaseId: productionRuntime.currentReleaseId,
        })
        .from(productionRuntime)
        .where(eq(productionRuntime.websiteId as never, websiteId) as never)
        .limit(1);
      if (!current)
        return NextResponse.json(
          { error: { code: 'PRODUCTION_NOT_FOUND', message: 'Production 网站尚未创建' } },
          { status: 404 },
        );
      const [workspaceRow] = await authDb
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.websiteId as never, websiteId) as never)
        .limit(1);
      const endpoint = process.env.WORKSPACE_GATEWAY_ENDPOINT;
      const token = process.env.WORKSPACE_GATEWAY_CLIENT_TOKEN;
      if (!workspaceRow || !endpoint || !token)
        return NextResponse.json(
          { error: { code: 'PRODUCTION_UNAVAILABLE', message: 'Production 状态暂不可用' } },
          { status: 503 },
        );
      const status = await new ProductionClient(endpoint, token, {
        websiteId,
        workspaceId: workspaceRow.id,
      }).status({ productionSlug: current.productionSlug });
      const persistedStatus = status.status === 'missing' ? 'failed' : status.status;
      if (status.currentReleaseId) {
        await authDb.transaction(async (tx) => {
          await tx
            .update(websiteRelease)
            .set({ status: 'superseded' })
            .where(
              and(
                eq(websiteRelease.websiteId as never, websiteId),
                eq(websiteRelease.status as never, 'active'),
                sql`${websiteRelease.id} <> ${status.currentReleaseId}`,
              ) as never,
            );
          await tx
            .update(websiteRelease)
            .set({ status: 'active', activatedAt: new Date() })
            .where(eq(websiteRelease.id as never, status.currentReleaseId) as never);
          await tx
            .update(operation)
            .set({
              status: 'succeeded',
              resultResourceId: status.currentReleaseId,
              finishedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(operation.id as never, status.currentReleaseId),
                eq(operation.type as never, 'website.publish'),
              ) as never,
            );
          await tx
            .update(productionRuntime)
            .set({
              status: persistedStatus,
              currentReleaseId: status.currentReleaseId,
              productionPort: status.productionPort,
              updatedAt: new Date(),
              ...(status.status === 'missing'
                ? { lastErrorCode: 'PRODUCTION_RUNTIME_MISSING' }
                : { lastErrorCode: null, lastErrorMessage: null }),
            })
            .where(eq(productionRuntime.id as never, current.id) as never);
        });
      } else {
        await authDb
          .update(productionRuntime)
          .set({
            status: persistedStatus,
            productionPort: status.productionPort,
            updatedAt: new Date(),
            ...(status.status === 'missing' ? { lastErrorCode: 'PRODUCTION_RUNTIME_MISSING' } : {}),
          })
          .where(eq(productionRuntime.id as never, current.id) as never);
      }
      return NextResponse.json({
        status: persistedStatus,
        url: productionUrlForSlug(current.productionSlug),
        currentReleaseId: status.currentReleaseId,
        authorized: status.authorized,
      });
    } catch (error) {
      if (error instanceof AuthorizationError)
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      return NextResponse.json(
        { error: { code: 'PRODUCTION_STATUS_UNAVAILABLE', message: 'Production 状态暂不可用' } },
        { status: 503 },
      );
    }
  });
}
