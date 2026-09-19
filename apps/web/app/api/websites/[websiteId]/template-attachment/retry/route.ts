import { NextResponse } from 'next/server';
import {
  assertSameOrigin,
  assertWebsiteAccessForUser,
  AuthorizationError,
  getUserRole,
  requireSession,
} from '@cloudcrane/auth';
import { auth } from '../../../../../../lib/server/auth.js';
import { attachTemplateReference } from '../../../../../../lib/server/template-attachment.js';
import {
  createProductionWebsiteStore,
  retryTemplateAttachment,
} from '../../../../../../lib/server/website-provisioning.js';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ websiteId: string }> }) {
  try {
    assertSameOrigin(request.headers);
    const session = await requireSession(auth, request.headers);
    const { websiteId } = await context.params;
    const role = getUserRole(session);
    const { platform, store } = createProductionWebsiteStore(
      role === 'admin' ? undefined : session.user.id,
    );
    try {
      await assertWebsiteAccessForUser(platform.db, session.user.id, role, websiteId);
      const workspaceId = await store.findWorkspaceId?.(websiteId);
      if (!workspaceId)
        return NextResponse.json({ error: { message: '工作区不存在' } }, { status: 404 });
      const result = await retryTemplateAttachment(websiteId, {
        store,
        workspaceId,
        attachTemplate: ({ websiteId: id, workspaceId: currentWorkspaceId, template }) =>
          attachTemplateReference({ websiteId: id, workspaceId: currentWorkspaceId, template }),
      });
      return NextResponse.json(result);
    } finally {
      await platform.pool.end();
    }
  } catch (error) {
    if (error instanceof AuthorizationError)
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    return NextResponse.json(
      { error: { code: 'TEMPLATE_ATTACH_FAILED', message: '模板应用失败，请稍后重试' } },
      { status: 502 },
    );
  }
}
