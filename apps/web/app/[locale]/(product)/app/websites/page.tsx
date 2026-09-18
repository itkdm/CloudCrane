import { UnifiedApp } from './unified-app';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/server/auth';

function parseView(value: string | undefined): 'websites' | 'templates' | undefined {
  if (value === 'templates') return 'templates';
  // Legacy conversation URLs now open the selected website directly.
  if (value === 'conversations' || value === 'websites') return 'websites';
  return undefined;
}

export default async function WebsitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; websiteId?: string; sessionId?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    redirect(
      `/${locale}/sign-in?callbackUrl=${encodeURIComponent(`/${locale}/app/websites${query.view === 'templates' ? '?view=templates' : ''}`)}`,
    );
  return (
    <UnifiedApp
      initialState={{
        view: parseView(query.view),
        websiteId: query.websiteId ?? null,
        sessionId: query.sessionId ?? null,
      }}
    />
  );
}
