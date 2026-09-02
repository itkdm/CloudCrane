import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { LanguageSwitcher } from './language-switcher';
import { Brand } from './brand';

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('navigation');
  return (
    <div className="marketing-layout">
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
          <Link className="cc-button cc-button-primary cc-button-sm" href="/app/websites">
            {t('startBuilding')}
          </Link>
        </div>
      </header>
      <main>{children}</main>
      <footer className="marketing-footer">
        {t('product')} · <Brand />
      </footer>
    </div>
  );
}
