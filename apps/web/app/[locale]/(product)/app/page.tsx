import { useTranslations } from 'next-intl';
import { Link } from '../../../../i18n/navigation';
export default function AppPage() {
  const t = useTranslations('app');
  return (
    <section className="cc-page-foundation">
      <h1>{t('title')}</h1>
      <p>{t('welcome')}</p>
      <Link className="cc-button cc-button-primary" href="/app/websites">
        {t('createWebsite')}
      </Link>
      <div className="cc-foundation-grid">
        <Link className="cc-card" href="/app/websites">
          <h2>{t('recentWebsites')}</h2>
          <p>{t('noWebsites')}</p>
        </Link>
        <Link className="cc-card" href="/templates">
          <h2>{t('templatesEntry')}</h2>
          <p>{t('templatesDescription')}</p>
        </Link>
      </div>
    </section>
  );
}
