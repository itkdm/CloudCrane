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
  searchParams,
}: {
  searchParams: Promise<{ view?: string; websiteId?: string; sessionId?: string }>;
}) {
  const params = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    redirect(`/sign-in?callbackUrl=/${params.view === 'templates' ? 'templates' : 'app/websites'}`);
  return (
    <UnifiedApp
      initialState={{
        view: parseView(params.view),
        websiteId: params.websiteId ?? null,
        sessionId: params.sessionId ?? null,
      }}
    />
  );
}
