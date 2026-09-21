import { NextResponse } from 'next/server';
import {
  assertSameOrigin,
  assertWebsiteAccessForUser,
  AuthorizationError,
  getUserRole,
  requireSession,
} from '@cloudcrane/auth';
import { finishAuditEvent, insertAuditEvent } from '@cloudcrane/db';
import { getActiveTraceContext } from '@cloudcrane/shared';
import { auth, authDb } from '../../../../../lib/server/auth.js';
import { previewUrlForWebsite } from '../../../../../lib/server/pboot-authorization.js';
import { withWebRequestContext } from '../../../../../lib/server/observability.js';
import {
  createWebsiteShare,
  DEFAULT_SHARE_EXPIRATION,
  isShareExpiration,
  listWebsiteShares,
  revokeWebsiteShare,
  shareUrlForWebsite,
} from '../../../../../lib/server/website-shares.js';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ websiteId: string }> };

export async function POST(request: Request, context: RouteContext) {
  return withWebRequestContext(request, 'POST /api/websites/:websiteId/shares', async () => {
    const authResult = await authorize(request, context, true);
    if (authResult instanceof Response) return authResult;
    const { session, websiteId, website } = authResult;
    const startedAt = Date.now();
    let auditId: string | undefined;
    try {
      const payload = await readPayload(request);
      const expiresIn = payload?.expiresIn ?? DEFAULT_SHARE_EXPIRATION;
      if (!isShareExpiration(expiresIn))
        return jsonError('INVALID_EXPIRATION', '有效期必须是 1h、1d、7d 或 30d', 400);

      auditId = await startAudit({
        actorId: session.user.id,
        actorType: getUserRole(session) === 'admin' ? 'admin' : 'user',
        websiteId,
        operation: 'website.share.create',
        request,
      });
      const result = await createWebsiteShare(authDb, {
        websiteId,
        expiresIn,
      });
      void finishAuditEvent(authDb, auditId, {
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        resultSummary: { shareId: result.share.id, expiresIn },
      }).catch(() => undefined);
      return NextResponse.json(
        {
          id: result.share.id,
          permission: result.share.permission,
          expiresAt: result.share.expiresAt,
          createdAt: result.share.createdAt,
          url: shareUrlForWebsite(previewUrlForWebsite(website.previewSlug), result.token),
        },
        { status: 201 },
      );
    } catch (error) {
      await finishAuditFailure(auditId, error, startedAt);
      if (error instanceof SyntaxError) return jsonError('INVALID_REQUEST', '请求内容无效', 400);
      return jsonError('SHARE_CREATE_FAILED', '创建分享链接失败，请稍后重试', 500);
    }
  });
}

export async function GET(request: Request, context: RouteContext) {
  return withWebRequestContext(request, 'GET /api/websites/:websiteId/shares', async () => {
    const authResult = await authorize(request, context, false);
    if (authResult instanceof Response) return authResult;
    try {
      const shares = await listWebsiteShares(authDb, authResult.websiteId);
      return NextResponse.json(
        shares.map(({ id, permission, expiresAt, revokedAt, createdAt }) => ({
          id,
          permission,
          expiresAt,
          revokedAt,
          createdAt,
        })),
      );
    } catch {
      return jsonError('SHARE_LIST_FAILED', '获取分享链接失败，请稍后重试', 500);
    }
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return withWebRequestContext(request, 'DELETE /api/websites/:websiteId/shares', async () => {
    const authResult = await authorize(request, context, true);
    if (authResult instanceof Response) return authResult;
    const shareId = new URL(request.url).searchParams.get('shareId');
    if (!shareId) return jsonError('INVALID_SHARE_ID', '缺少分享链接标识', 400);
    const startedAt = Date.now();
    let auditId: string | undefined;
    try {
      auditId = await startAudit({
        actorId: authResult.session.user.id,
        actorType: getUserRole(authResult.session) === 'admin' ? 'admin' : 'user',
        websiteId: authResult.websiteId,
        operation: 'website.share.revoke',
        request,
      });
      const revoked = await revokeWebsiteShare(authDb, {
        websiteId: authResult.websiteId,
        shareId,
      });
      if (!revoked) {
        void finishAuditEvent(authDb, auditId, {
          status: 'FAILED',
          durationMs: Date.now() - startedAt,
          errorCode: 'SHARE_NOT_FOUND',
        }).catch(() => undefined);
        return jsonError('SHARE_NOT_FOUND', '分享链接不存在或已撤销', 404);
      }
      void finishAuditEvent(authDb, auditId, {
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        resultSummary: { shareId, revoked: true },
      }).catch(() => undefined);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      await finishAuditFailure(auditId, error, startedAt);
      return jsonError('SHARE_REVOKE_FAILED', '撤销分享链接失败，请稍后重试', 500);
    }
  });
}

async function authorize(request: Request, context: RouteContext, requireOrigin: boolean) {
  try {
    if (requireOrigin) assertSameOrigin(request.headers);
    const session = await requireSession(auth, request.headers);
    const websiteId = (await context.params).websiteId;
    const ownedWebsite = await assertWebsiteAccessForUser(
      authDb,
      session.user.id,
      getUserRole(session),
      websiteId,
    );
    return { session, websiteId, website: ownedWebsite };
  } catch (error) {
    if (error instanceof AuthorizationError)
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    return jsonError('AUTHORIZATION_CHECK_FAILED', '暂时无法确认网站权限，请稍后重试', 500);
  }
}

async function readPayload(request: Request): Promise<{ expiresIn?: unknown } | null> {
  const payload: unknown = await request.json();
  if (!payload || typeof payload !== 'object') return null;
  return { expiresIn: (payload as { expiresIn?: unknown }).expiresIn };
}

async function startAudit(input: {
  actorId: string;
  actorType: 'user' | 'admin';
  websiteId: string;
  operation: string;
  request: Request;
}): Promise<string> {
  const traceContext = getActiveTraceContext();
  return insertAuditEvent(authDb, {
    actorType: input.actorType,
    actorUserId: input.actorId,
    websiteId: input.websiteId,
    operation: input.operation,
    resourceType: 'website_share',
    resourceRef: input.websiteId,
    requestId: input.request.headers.get('x-request-id') ?? undefined,
    traceId: traceContext.traceId,
    spanId: traceContext.spanId,
    status: 'PENDING',
    requestSummary: {},
  });
}

async function finishAuditFailure(auditId: string | undefined, error: unknown, startedAt: number) {
  if (!auditId) return;
  try {
    await finishAuditEvent(authDb, auditId, {
      status: 'FAILED',
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : 'SHARE_CREATE_FAILED',
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
  } catch {
    // Preserve the original API error; audit failures are already observable at the boundary.
  }
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}
