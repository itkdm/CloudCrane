'use client';

import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { Brand } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { ThemeSwitcher } from '../theme-switcher';

export function MarketingHeader() {
  const t = useTranslations('navigation');
  const common = useTranslations('common');
  const { data: session, isPending } = authClient.useSession();
  const destination = session ? '/app/websites' : '/sign-in';
  const label = isPending ? common('loading') : session ? t('workbench') : t('login');
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
          <Link
            className="marketing-button marketing-button-primary marketing-button-small"
            href={destination}
            aria-busy={isPending}
          >
            {label}
          </Link>
        </div>
      </header>
    </div>
  );
}
