import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { Brand } from './brand';
import { FooterNewsletter } from './footer-newsletter';

export function MarketingFooter() {
  const t = useTranslations('marketing');
  const navigation = useTranslations('navigation');
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-inner">
        <div className="marketing-footer-main">
          <div className="marketing-footer-copy">
            <Link className="cc-brand" href="/">
              <Brand />
            </Link>
            <p>{t('footerDescription')}</p>
            <Link className="marketing-footer-badge" href="/app/websites">
              <span>{t('footerBuiltFor')}</span>
              <span className="marketing-footer-badge-dot" aria-hidden="true" />
              <strong>CloudCrane</strong>
            </Link>
          </div>
          <div className="marketing-footer-column">
            <h2>{t('footerProduct')}</h2>
            <nav aria-label={t('footerProduct')}>
              <Link href="/app/websites">{t('footerWorkspace')}</Link>
              <a href="#workflow">{t('footerWorkflow')}</a>
              <a href="#capability">{t('footerCapabilities')}</a>
            </nav>
          </div>
          <div className="marketing-footer-column">
            <h2>{t('footerResources')}</h2>
            <nav aria-label={t('footerResources')}>
              <a href="https://muban.itkdm.com">{navigation('templates')}</a>
              <span className="marketing-nav-disabled" aria-disabled="true">
                {navigation('docs')}
              </span>
              <a href="mailto:hello@itkdm.com">{t('footerContact')}</a>
            </nav>
          </div>
          <div className="marketing-footer-column marketing-footer-languages">
            <h2>{t('footerLanguage')}</h2>
            <nav aria-label={t('footerLanguage')}>
              <Link href="/" locale="en">
                English
              </Link>
              <Link href="/" locale="zh">
                中文
              </Link>
            </nav>
          </div>
          <FooterNewsletter
            label={t('footerSubscribe')}
            description={t('footerSubscribeDescription')}
            placeholder={t('footerEmailPlaceholder')}
            submitLabel={t('footerSubscribeAction')}
            successMessage={t('footerSubscribeSuccess')}
          />
        </div>
        <div className="marketing-footer-bottom">
          <small>{t('copyright')}</small>
          <nav aria-label={t('footerLegal')}>
            <span className="marketing-nav-disabled" aria-disabled="true">
              {t('footerPrivacy')}
            </span>
            <span className="marketing-nav-disabled" aria-disabled="true">
              {t('footerTerms')}
            </span>
            <a href="mailto:hello@itkdm.com">{t('footerContact')}</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
