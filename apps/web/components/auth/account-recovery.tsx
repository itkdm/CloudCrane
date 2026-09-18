'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { authClient } from '@/lib/auth-client';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locale = useLocale();
  const t = useTranslations('auth');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: `/${locale}/reset-password`,
    });
    if (result.error) setError(t('resetRequestError'));
    else setMessage(t('resetRequestNotice'));
  }
  return (
    <RecoveryCard title={t('resetPassword')} onSubmit={submit}>
      <label>
        {t('email')}
        <input
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="auth-notice" role="status">
          {message}
        </p>
      )}
      <button type="submit">{t('sendResetLink')}</button>
    </RecoveryCard>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations('auth');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) setError(t('resetInvalid'));
    else setMessage(t('resetSuccess'));
  }
  return (
    <RecoveryCard title={t('newPassword')} onSubmit={submit}>
      <label>
        {t('newPassword')}
        <input
          required
          minLength={8}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="auth-notice" role="status">
          {message}
        </p>
      )}
      <button type="submit">{t('updatePassword')}</button>
    </RecoveryCard>
  );
}

function RecoveryCard({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations('auth');
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>{title}</h1>
        <form onSubmit={onSubmit} className="auth-form">
          {children}
        </form>
        <a className="auth-link" href={`/${locale}/sign-in`}>
          {t('backToSignIn')}
        </a>
      </section>
    </main>
  );
}
