import { requireWebsiteAccess, AuthorizationError } from '@cloudcrane/auth';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth, authDb } from '@/lib/server/auth';
import { UnifiedApp } from '../../unified-app';

export default async function WebsiteSessionsPage({
  params,
}: {
  params: Promise<{ locale: string; websiteId: string }>;
}) {
  const { locale, websiteId } = await params;
  try {
    await requireWebsiteAccess(authDb, auth, await headers(), websiteId);
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === 'AUTHENTICATION_REQUIRED') {
      redirect(
        `/${locale}/sign-in?callbackUrl=${encodeURIComponent(`/${locale}/app/websites/${websiteId}/sessions`)}`,
      );
    }
    notFound();
  }

  return <UnifiedApp initialState={{ websiteId }} />;
}
