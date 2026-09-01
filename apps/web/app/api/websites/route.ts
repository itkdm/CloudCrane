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

export const runtime = 'nodejs';

export async function GET() {
  const { platform, store } = createProductionWebsiteStore();
  try {
    return NextResponse.json(await listWebsites(store));
  } finally {
    await platform.pool.end();
  }
}

export async function POST(request: Request) {
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
  const { platform, store } = createProductionWebsiteStore();
  try {
    const result = await createWebsite(name, {
      store,
      runtime: ({ websiteId, workspaceId }) => createProductionRuntime(websiteId, workspaceId),
    });
    return NextResponse.json(publicWebsiteView(result.website), {
      status: result.provisioned ? 201 : 502,
    });
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
