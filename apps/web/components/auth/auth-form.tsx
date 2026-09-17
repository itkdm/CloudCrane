'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    const result =
      mode === 'sign-in'
        ? await authClient.signIn.email({ email, password, callbackURL: '/zh/app/websites' })
        : await authClient.signUp.email({ name, email, password, callbackURL: '/zh/app/websites' });
    setPending(false);
    if (result.error) setError(result.error.message ?? '操作失败，请稍后重试');
    else if (mode === 'sign-up') setNotice('注册成功，请查收邮箱并完成验证后登录。');
    else window.location.assign('/zh/app/websites');
  }

  async function signInWithGoogle() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/zh/app/websites',
    });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? 'Google 登录不可用');
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="auth-eyebrow">CLOUDCRANE</p>
        <h1>{mode === 'sign-in' ? '登录你的工作区' : '创建 CloudCrane 账户'}</h1>
        <p className="auth-description">
          {mode === 'sign-in' ? '登录后管理你拥有的网站。' : '创建账户后即可创建并管理网站。'}
        </p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'sign-up' && (
            <label>
              姓名
              <input required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          <label>
            邮箱
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            密码
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
            {pending ? '处理中…' : mode === 'sign-in' ? '登录' : '注册'}
          </button>
        </form>
        {mode === 'sign-in' && (
          <a className="auth-link" href="/zh/forgot-password">
            忘记密码？
          </a>
        )}
        <button
          className="auth-secondary"
          disabled={pending}
          onClick={signInWithGoogle}
          type="button"
        >
          使用 Google 登录
        </button>
        <a className="auth-link" href={mode === 'sign-in' ? '/zh/sign-up' : '/zh/sign-in'}>
          {mode === 'sign-in' ? '还没有账户？注册' : '已有账户？登录'}
        </a>
      </section>
    </main>
  );
}
