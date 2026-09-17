import { redirect } from 'next/navigation';
import { requireWebsiteAccess, AuthorizationError } from '@cloudcrane/auth';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { auth, authDb } from '@/lib/server/auth';

export default async function AgentWorkbenchPage({
  params,
}: {
  params: Promise<{ locale: string; websiteId: string }>;
}) {
  const { locale, websiteId } = await params;
  try {
    await requireWebsiteAccess(authDb, auth, await headers(), websiteId);
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === 'AUTHENTICATION_REQUIRED')
      redirect(`/${locale}/sign-in`);
    notFound();
  }
  redirect(`/${locale}/app/websites?view=conversations&websiteId=${encodeURIComponent(websiteId)}`);
}
