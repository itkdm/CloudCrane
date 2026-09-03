import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';

export function MarketingHero() {
  const t = useTranslations('marketing');
  return (
    <section className="marketing-hero" aria-labelledby="marketing-title">
      <div className="marketing-hero-copy">
        <p className="marketing-eyebrow">{t('eyebrow')}</p>
        <h1 id="marketing-title">
          <span className="marketing-title-line">{t('heroTitleLine1')}</span>
          <span className="marketing-title-line">{t('heroTitleLine2')}</span>
        </h1>
        <p className="marketing-hero-lede">{t('lede')}</p>
        <div className="marketing-hero-actions">
          <Link className="marketing-button marketing-button-primary" href="/app/websites">
            {t('cta')}
          </Link>
        </div>
      </div>
    </section>
  );
}
