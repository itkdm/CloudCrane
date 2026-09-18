'use client';

import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function VerifyEmailPage() {
  const [status, setStatus] = useState('正在验证邮箱…');
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setStatus('验证链接无效。');
      return;
    }
    void authClient.verifyEmail({ query: { token } }).then((result) => {
      setStatus(result.error ? '验证链接无效或已过期。' : '邮箱验证成功，请进入工作区。');
    });
  }, []);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>邮箱验证</h1>
        <p className="auth-description" role="status">
          {status}
        </p>
        <a className="auth-link" href="/zh/sign-in">
          返回登录
        </a>
      </section>
    </main>
  );
}
