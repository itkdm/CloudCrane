import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { Brand } from './brand';
import { LanguageSwitcher } from './language-switcher';

export function MarketingHeader() {
  const t = useTranslations('navigation');
  return (
    <header className="marketing-header">
      <Link className="cc-brand" href="/">
        <Brand />
      </Link>
      <nav aria-label={t('product')}>
        <Link href="/">{t('product')}</Link>
        <Link href="/templates">{t('templates')}</Link>
        <Link href="/docs">{t('docs')}</Link>
      </nav>
      <div className="marketing-header-actions">
        <LanguageSwitcher />
        <Link
          className="marketing-button marketing-button-primary marketing-button-small"
          href="/app/websites"
        >
          {t('startBuilding')}
        </Link>
      </div>
    </header>
  );
}
