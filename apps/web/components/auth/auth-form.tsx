'use client';

import { Suspense, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return (
    <Suspense fallback={<main className="auth-page" aria-busy="true" />}>
      <AuthFormContent mode={mode} />
    </Suspense>
  );
}

function AuthFormContent({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const locale = useLocale();
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'), locale);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    const result =
      mode === 'sign-in'
        ? await authClient.signIn.email({ email, password, callbackURL: callbackUrl })
        : await authClient.signUp.email({ name, email, password, callbackURL: callbackUrl });
    setPending(false);
    if (result.error) setError(result.error.message ?? t('operationError'));
    else if (mode === 'sign-up' && !result.data?.user) setError(t('operationError'));
    else if (mode === 'sign-up') {
      if (process.env.NEXT_PUBLIC_AUTH_REQUIRE_EMAIL_VERIFICATION === 'false')
        window.location.assign(callbackUrl);
      else setNotice(t('signUpSuccess'));
    } else window.location.assign(callbackUrl);
  }

  async function signInWithGoogle() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: callbackUrl,
    });
    if (result.error) {
      setPending(false);
      setError(
        result.error.message === 'Provider not found'
          ? t('googleUnavailable')
          : (result.error.message ?? t('googleError')),
      );
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>{mode === 'sign-in' ? t('signInTitle') : t('signUpTitle')}</h1>
        <p className="auth-description">
          {mode === 'sign-in' ? t('signInDescription') : t('signUpDescription')}
        </p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'sign-up' && (
            <label>
              {t('username')}
              <input
                required
                autoComplete="username"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <label>
            {t('email')}
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            {t('password')}
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
          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}
          <button disabled={pending} type="submit">
            {pending ? t('processing') : mode === 'sign-in' ? t('signIn') : t('signUp')}
          </button>
        </form>
        {mode === 'sign-in' && (
          <a className="auth-link" href={`/${locale}/forgot-password`}>
            {t('forgotPassword')}
          </a>
        )}
        <button
          className="auth-secondary"
          disabled={pending}
          onClick={signInWithGoogle}
          type="button"
        >
          <GoogleIcon />
          {t('googleSignIn')}
        </button>
        <a className="auth-link" href={`/${locale}/${mode === 'sign-in' ? 'sign-up' : 'sign-in'}`}>
          {mode === 'sign-in' ? t('noAccount') : t('hasAccount')}
        </a>
      </section>
    </main>
  );
}

function safeCallbackUrl(value: string | null, locale: string): string {
  const fallback = `/${locale}/app/websites`;
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('://'))
    return fallback;
  return value;
}

function GoogleIcon() {
  return (
    <svg className="auth-google-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.35 12.27c0-.71-.06-1.39-.18-2.05H12v3.88h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.22Z"
      />
      <path
        fill="#34A853"
        d="M12 21.75c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.93-3.31.93-2.54 0-4.7-1.72-5.47-4.03H3.29v2.53A9.75 9.75 0 0 0 12 21.75Z"
      />
      <path
        fill="#FBBC05"
        d="M6.53 13.84a5.86 5.86 0 0 1 0-3.68V7.63H3.29a9.75 9.75 0 0 0 0 8.74l3.24-2.53Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.13c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.84 3.22 14.63 2.25 12 2.25a9.75 9.75 0 0 0-8.71 5.38l3.24 2.53C7.3 7.85 9.46 6.13 12 6.13Z"
      />
    </svg>
  );
}
