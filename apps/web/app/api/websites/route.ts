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

export const runtime = 'nodejs';

export async function GET(request: Request) {
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
}

export async function POST(request: Request) {
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
  const { platform, store } = createProductionWebsiteStore(session.user.id);
  try {
    const result = await createWebsite(name, {
      store,
      ownerId: session.user.id,
      runtime: ({ websiteId, workspaceId }) => createProductionRuntime(websiteId, workspaceId),
    });
    return NextResponse.json(
      { ...publicWebsiteView(result.website), previewUrl: previewUrlForWebsite(result.website.id) },
      {
        status: result.provisioned ? 201 : 502,
      },
    );
  } catch (error) {
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
}
