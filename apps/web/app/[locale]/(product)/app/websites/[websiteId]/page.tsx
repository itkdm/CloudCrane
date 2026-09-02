import { useTranslations } from 'next-intl';
import { Link } from '../../../../../../i18n/navigation';

export default function WebsiteOverviewPage({
  params,
}: {
  params: Promise<{ websiteId: string }>;
}) {
  return <WebsiteOverviewContent params={params} />;
}

async function WebsiteOverviewContent({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
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
      <Link className="cc-button cc-button-primary" href={`/app/websites/${websiteId}/agent`}>
        {t('continueBuilding')}
      </Link>
    </section>
  );
}
