import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { LanguageSwitcher } from './language-switcher';
import { Brand } from './brand';

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('navigation');
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="cc-brand" href="/">
          <Brand />
        </Link>
        <nav aria-label={t('home')}>
          <Link href="/app">{t('home')}</Link>
          <Link href="/app/websites">{t('websites')}</Link>
          <Link href="/templates">{t('templates')}</Link>
        </nav>
      </aside>
      <div className="app-content">
        <header className="app-header">
          <span>{t('product')}</span>
          <LanguageSwitcher />
        </header>
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
