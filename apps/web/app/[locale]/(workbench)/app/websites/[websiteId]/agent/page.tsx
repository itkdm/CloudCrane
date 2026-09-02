import { redirect } from 'next/navigation';

export default async function AgentWorkbenchPage({
  params,
}: {
  params: Promise<{ locale: string; websiteId: string }>;
}) {
  const { locale, websiteId } = await params;
  redirect(`/${locale}/app/websites?view=conversations&websiteId=${encodeURIComponent(websiteId)}`);
}
