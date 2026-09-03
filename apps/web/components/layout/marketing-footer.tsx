import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { Brand } from './brand';

export function MarketingFooter() {
  const t = useTranslations('marketing');
  const navigation = useTranslations('navigation');
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-copy">
        <Link className="cc-brand" href="/">
          <Brand />
        </Link>
        <p>{t('footerDescription')}</p>
      </div>
      <nav aria-label={navigation('mainNavigation')}>
        <a href="https://muban.itkdm.com">{navigation('templates')}</a>
        <span className="marketing-nav-disabled" aria-disabled="true">
          {navigation('docs')}
        </span>
      </nav>
      <small>{t('copyright')}</small>
    </footer>
  );
}
