'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: '/zh/reset-password',
    });
    if (result.error) setError('请求失败，请稍后重试。');
    else setMessage('如果该邮箱已注册，密码重置链接将发送到邮箱。');
  }
  return (
    <RecoveryCard title="重置密码" onSubmit={submit}>
      <label>
        邮箱
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
      <button type="submit">发送重置链接</button>
    </RecoveryCard>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) setError('链接无效或已过期，请重新申请。');
    else setMessage('密码已更新，请重新登录。');
  }
  return (
    <RecoveryCard title="设置新密码" onSubmit={submit}>
      <label>
        新密码
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
      <button type="submit">更新密码</button>
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
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="auth-eyebrow">CLOUDCRANE</p>
        <h1>{title}</h1>
        <form onSubmit={onSubmit} className="auth-form">
          {children}
        </form>
        <a className="auth-link" href="/zh/sign-in">
          返回登录
        </a>
      </section>
    </main>
  );
}
