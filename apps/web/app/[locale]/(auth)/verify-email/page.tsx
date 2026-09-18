'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { authClient } from '@/lib/auth-client';

export default function VerifyEmailPage() {
  const locale = useLocale();
  const t = useTranslations('auth');
  const [status, setStatus] = useState(t('verificationLoading'));
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setStatus(t('verificationInvalid'));
      return;
    }
    void authClient.verifyEmail({ query: { token } }).then((result) => {
      setStatus(result.error ? t('verificationExpired') : t('verificationSuccess'));
    });
  }, [t]);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>{t('verificationTitle')}</h1>
        <p className="auth-description" role="status">
          {status}
        </p>
        <a className="auth-link" href={`/${locale}/sign-in`}>
          {t('backToSignIn')}
        </a>
      </section>
    </main>
  );
}
