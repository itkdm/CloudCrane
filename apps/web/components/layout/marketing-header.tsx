import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { Brand } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { ThemeSwitcher } from '../theme-switcher';

export function MarketingHeader() {
  const t = useTranslations('navigation');
  return (
    <div className="marketing-header-wrapper">
      <header className="marketing-header">
        <div className="marketing-header-left">
          <Link className="cc-brand" href="/">
            <Brand />
          </Link>
          <nav aria-label={t('mainNavigation')}>
            <a href="https://muban.itkdm.com">{t('templates')}</a>
            <span className="marketing-nav-disabled" aria-disabled="true">
              {t('docs')}
            </span>
          </nav>
        </div>
        <div className="marketing-header-actions">
          <LanguageSwitcher />
          <ThemeSwitcher />
          <Link
            className="marketing-button marketing-button-primary marketing-button-small"
            href="/app/websites"
          >
            {t('startBuilding')}
          </Link>
        </div>
      </header>
    </div>
  );
}
