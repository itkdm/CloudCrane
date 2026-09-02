import { redirect } from 'next/navigation';

export default async function AppEntryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/app/websites`);
}
