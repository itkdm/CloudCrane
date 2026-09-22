import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { Brand } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { ThemeSwitcher } from '../theme-switcher';
import { StartBuildingLink } from './start-building-link';

export function MarketingHeader() {
  const t = useTranslations('navigation');
  const common = useTranslations('common');
  return (
    <div className="marketing-header-wrapper">
      <header className="marketing-header">
        <div className="marketing-header-left">
          <Link className="cc-brand" href="/">
            <Brand />
          </Link>
          <nav aria-label={t('mainNavigation')}>
            <a href="#capability">{t('features')}</a>
            <a href="#pricing">{t('pricing')}</a>
            <a href="https://muban.itkdm.com">{t('templates')}</a>
            <span className="marketing-nav-disabled" aria-disabled="true">
              {t('docs')}
            </span>
          </nav>
        </div>
        <div className="marketing-header-actions">
          <LanguageSwitcher />
          <ThemeSwitcher />
          <StartBuildingLink
            className="marketing-button marketing-button-primary marketing-button-small"
            pendingLabel={common('loading')}
          >
            {t('startBuilding')}
          </StartBuildingLink>
        </div>
      </header>
    </div>
  );
}
