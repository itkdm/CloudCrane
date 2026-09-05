import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // TODO: 实际应该从数据库获取所有会话
    // 这里返回模拟数据
    const sessions = [
      {
        id: 'session-1',
        websiteId: 'website-1',
        title: '参考当前只详细网站板...',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'session-2',
        websiteId: 'website-1',
        title: '新对话',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    return NextResponse.json(sessions);
  } catch {
    return NextResponse.json(
      { error: { message: '获取会话列表失败' } },
      { status: 500 }
    );
  }
}
