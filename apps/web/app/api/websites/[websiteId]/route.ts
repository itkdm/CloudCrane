import { NextResponse } from 'next/server';
import {
  createProductionRuntime,
  createProductionWebsiteStore,
} from '../../../../lib/server/website-provisioning.js';
import { disposeAgentRuntime, finalizeAgentRuntime } from '../../../../lib/server/agent-runtime.js';
import {
  assertSameOrigin,
  AuthorizationError,
  getUserRole,
  requireSession,
} from '@cloudcrane/auth';
import { auth } from '../../../../lib/server/auth.js';
import { finishAuditEvent, insertAuditEvent } from '@cloudcrane/db';
import { getActiveTraceContext } from '@cloudcrane/shared';
import { withWebRequestContext } from '../../../../lib/server/observability.js';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withWebRequestContext(request, 'DELETE /api/websites/:websiteId', async () => {
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
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: '认证失败' } },
        { status: 401 },
      );
    }

    const { websiteId } = await params;
    const { platform, store } = createProductionWebsiteStore(
      getUserRole(session) === 'admin' ? undefined : session.user.id,
    );
    const startedAt = Date.now();
    let auditId: string | undefined;
    try {
      try {
        const traceContext = getActiveTraceContext();
        auditId = await insertAuditEvent(platform.db, {
          actorType: getUserRole(session) === 'admin' ? 'admin' : 'user',
          actorUserId: session.user.id,
          operation: 'website.delete',
          resourceType: 'website',
          resourceRef: websiteId,
          requestId: request.headers.get('x-request-id') ?? undefined,
          traceId: traceContext.traceId,
          spanId: traceContext.spanId,
          status: 'PENDING',
          requestSummary: {},
        });
      } catch {
        return NextResponse.json(
          { error: { code: 'AUDIT_UNAVAILABLE', message: '审计服务暂不可用，请稍后重试' } },
          { status: 503 },
        );
      }

      const workspace = await store.findWorkspace?.(websiteId);
      if (!workspace) {
        await finishAuditEvent(platform.db, auditId, {
          status: 'FAILED',
          durationMs: Date.now() - startedAt,
          errorCode: 'WEBSITE_NOT_FOUND',
        });
        return NextResponse.json(
          { error: { code: 'WEBSITE_NOT_FOUND', message: '网站不存在或无权访问' } },
          { status: 404 },
        );
      }

      await store.updateWebsiteStatus(websiteId, 'deleting');
      await disposeAgentRuntime(websiteId);
      if (workspace.status !== 'missing') {
        const runtime = createProductionRuntime(websiteId, workspace.id);
        if (!runtime.destroy) throw new Error('workspace runtime destroy is not configured');
        await runtime.destroy();
      }
      const deleted = await store.deleteWebsite?.(websiteId);
      if (!deleted) {
        await finishAuditEvent(platform.db, auditId, {
          status: 'FAILED',
          durationMs: Date.now() - startedAt,
          errorCode: 'WEBSITE_NOT_FOUND',
        });
        return NextResponse.json(
          { error: { code: 'WEBSITE_NOT_FOUND', message: '网站不存在或无权访问' } },
          { status: 404 },
        );
      }
      try {
        await finishAuditEvent(platform.db, auditId, {
          status: 'SUCCESS',
          durationMs: Date.now() - startedAt,
          resultSummary: { deleted: true },
        });
      } catch {
        // The destructive operation is complete; do not report it as failed.
      }
      await finalizeAgentRuntime(websiteId);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      if (auditId) {
        try {
          await finishAuditEvent(platform.db, auditId, {
            status: 'FAILED',
            durationMs: Date.now() - startedAt,
            errorCode: error instanceof Error ? error.name : 'DELETE_FAILED',
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          });
        } catch {
          return NextResponse.json(
            {
              error: { code: 'AUDIT_UNKNOWN', message: '删除结果暂时无法确认，请稍后检查网站列表' },
            },
            { status: 503 },
          );
        }
      }
      return NextResponse.json(
        { error: { code: 'DELETE_FAILED', message: '网站删除失败，请稍后重试' } },
        { status: 502 },
      );
    } finally {
      await platform.pool.end();
    }
  });
}
