import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';

export function MarketingHero() {
  const t = useTranslations('marketing');
  return (
    <section className="marketing-hero" aria-labelledby="marketing-title">
      <div className="marketing-hero-copy">
        <p className="marketing-eyebrow">{t('eyebrow')}</p>
        <h1 id="marketing-title">{t('title')}</h1>
        <p className="marketing-hero-lede">{t('lede')}</p>
        <div className="marketing-hero-actions">
          <Link className="marketing-button marketing-button-primary" href="/app/websites">
            {t('cta')}
          </Link>
          <Link className="marketing-button marketing-button-secondary" href="#workflow">
            {t('workflowLink')}
          </Link>
        </div>
      </div>
      <div className="product-visual" aria-label={t('visualLabel')}>
        <div className="product-visual-topbar">
          <span className="product-visual-dot" />
          <span className="product-visual-dot" />
          <span className="product-visual-dot" />
          <span className="product-visual-url">preview.cloudcrane.dev</span>
        </div>
        <div className="product-visual-body">
          <div className="product-chat">
            <span className="product-label">{t('visualConversation')}</span>
            <p>{t('visualPrompt')}</p>
            <div className="product-progress">
              <span />
            </div>
            <small>{t('visualWorking')}</small>
          </div>
          <div className="product-preview">
            <span className="product-label">{t('visualPreview')}</span>
            <div className="preview-browser">
              <div className="preview-heading" />
              <div className="preview-line preview-line-wide" />
              <div className="preview-line" />
              <div className="preview-button" />
              <div className="preview-cards">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
