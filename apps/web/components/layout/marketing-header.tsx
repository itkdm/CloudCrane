'use client';

import { useTranslations } from 'next-intl';
import { UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { Brand } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { ThemeSwitcher } from '../theme-switcher';

export function MarketingHeader() {
  const t = useTranslations('navigation');
  const common = useTranslations('common');
  const { data: session, isPending } = authClient.useSession();
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [session?.user.image]);

  const userLabel = session?.user.name?.trim() || session?.user.email || t('user');
  const initials = userLabel.slice(0, 2).toUpperCase();
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
          {session && !isPending ? (
            <Link
              className="marketing-header-avatar"
              href="/app/websites"
              aria-label={t('workbench')}
              title={`${userLabel} · ${t('workbench')}`}
            >
              {session.user.image && !avatarFailed ? (
                <img
                  src={session.user.image}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                />
              ) : initials ? (
                <span aria-hidden="true">{initials}</span>
              ) : (
                <UserRound size={18} aria-hidden="true" />
              )}
            </Link>
          ) : (
            <Link
              className="marketing-button marketing-button-primary marketing-button-small"
              href="/sign-in"
              aria-busy={isPending}
            >
              {isPending ? common('loading') : t('login')}
            </Link>
          )}
        </div>
      </header>
    </div>
  );
}
