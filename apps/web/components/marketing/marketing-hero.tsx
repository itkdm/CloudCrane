import { useTranslations } from 'next-intl';
import { StartBuildingLink } from '../layout/start-building-link';

export function MarketingHero() {
  const t = useTranslations('marketing');
  const common = useTranslations('common');
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
          <StartBuildingLink
            className="marketing-button marketing-button-primary"
            pendingLabel={common('loading')}
          >
            {t('cta')}
          </StartBuildingLink>
        </div>
      </div>
    </section>
  );
}
