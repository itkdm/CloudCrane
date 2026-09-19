import { NextResponse } from 'next/server';
import { AuthorizationError, requireSession } from '@cloudcrane/auth';
import { auth } from '../../../lib/server/auth.js';
import { createTemplateCatalog } from '../../../lib/server/template-catalog.js';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireSession(auth, request.headers);
    const category = new URL(request.url).searchParams.get('category') ?? undefined;
    const catalog = createTemplateCatalog();
    try {
      return NextResponse.json(await catalog.listPublished(category));
    } finally {
      await catalog.platform.pool.end();
    }
  } catch (error) {
    if (error instanceof AuthorizationError)
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    return NextResponse.json({ error: { message: '获取模板列表失败' } }, { status: 500 });
  }
}
