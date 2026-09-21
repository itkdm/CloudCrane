import { requireWebsiteAccess, AuthorizationError } from '@cloudcrane/auth';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth, authDb } from '@/lib/server/auth';
import { useTranslations } from 'next-intl';
import { Link } from '../../../../../../i18n/navigation';

export default function WebsiteOverviewPage({
  params,
}: {
  params: Promise<{ locale: string; websiteId: string }>;
}) {
  return <WebsiteOverviewContent params={params} />;
}

async function WebsiteOverviewContent({
  params,
}: {
  params: Promise<{ locale: string; websiteId: string }>;
}) {
  const { locale, websiteId } = await params;
  try {
    await requireWebsiteAccess(authDb, auth, await headers(), websiteId);
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === 'AUTHENTICATION_REQUIRED')
      redirect(
        `/${locale}/sign-in?callbackUrl=${encodeURIComponent(`/${locale}/app/websites/${websiteId}`)}`,
      );
    notFound();
  }
  return <Overview websiteId={websiteId} />;
}

function Overview({ websiteId }: { websiteId: string }) {
  const t = useTranslations('app');
  return (
    <section className="cc-page-foundation">
      <p className="websites-eyebrow">{websiteId}</p>
      <h1>{t('overviewTitle')}</h1>
      <div className="cc-card">
        <p>{t('overviewStatus')}: —</p>
        <p>{t('overviewPreview')}: —</p>
      </div>
      <Link className="cc-button cc-button-primary" href={`/app/websites/${websiteId}/sessions`}>
        {t('continueBuilding')}
      </Link>
    </section>
  );
}
