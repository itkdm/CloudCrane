import { NextResponse } from 'next/server';
import { assertSameOrigin, AuthorizationError, requireWebsiteAccess } from '@cloudcrane/auth';
import { auth, authDb } from '../../../../../lib/server/auth.js';
import {
  configurePbootAuthorization,
  PbootAuthorizationError,
} from '../../../../../lib/server/pboot-authorization.js';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
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
  try {
    await requireWebsiteAccess(authDb, auth, request.headers, websiteId);
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
  const sn = payload && typeof payload === 'object' ? (payload as { sn?: unknown }).sn : undefined;
  try {
    return NextResponse.json(await configurePbootAuthorization(websiteId, sn));
  } catch (error) {
    if (error instanceof PbootAuthorizationError)
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_CODE' ? 400 : 409 },
      );
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '授权配置失败' } },
      { status: 500 },
    );
  }
}
