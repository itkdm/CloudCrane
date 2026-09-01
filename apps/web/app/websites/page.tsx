'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

type Website = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  previewUrl?: string;
};

function statusLabel(status: string): string {
  if (status === 'ready') return '环境已准备';
  if (status === 'provisioning') return '正在创建网站环境…';
  if (status === 'initializing') return '正在初始化网站…';
  if (status === 'initialization_failed') return '网站初始化失败';
  if (status === 'authorization_required') return 'PbootCMS 待授权';
  if (status === 'provisioning_failed') return '创建失败';
  return '准备中';
}

export default function WebsitesPage() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [authorizationWebsite, setAuthorizationWebsite] = useState<Website | null>(null);
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [authorizing, setAuthorizing] = useState(false);

  useEffect(() => {
    fetch('/api/websites')
      .then(async (response) => {
        if (!response.ok) throw new Error('网站列表加载失败');
        return response.json() as Promise<Website[]>;
      })
      .then(setWebsites)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : '网站列表加载失败'),
      )
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/websites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as Website | { error?: { message?: string } };
      if (!response.ok || !('id' in payload)) {
        throw new Error(('error' in payload && payload.error?.message) || '创建网站失败');
      }
      setWebsites((current) => [payload, ...current]);
      setName('');
      setFormOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建网站失败');
    } finally {
      setCreating(false);
    }
  }

  async function submitAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorizationWebsite) return;
    setAuthorizing(true);
    setError('');
    try {
      const response = await fetch(`/api/websites/${authorizationWebsite.id}/pboot-authorization`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sn: authorizationCode }),
      });
      const payload = (await response.json()) as { status?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || '授权验证失败');
      setWebsites((current) =>
        current.map((website) =>
          website.id === authorizationWebsite.id
            ? { ...website, status: payload.status ?? 'ready' }
            : website,
        ),
      );
      setAuthorizationCode('');
      setAuthorizationWebsite(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '授权验证失败');
    } finally {
      setAuthorizing(false);
    }
  }

  return (
    <main className="websites-page">
      <header className="websites-header">
        <div>
          <p className="websites-eyebrow">CloudCrane · 筑云鹤</p>
          <h1>我的网站</h1>
          <p>管理你正在建设的网站。</p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => setFormOpen((open) => !open)}
        >
          创建网站
        </button>
      </header>

      {formOpen ? (
        <form className="website-create-form" onSubmit={submit}>
          <label htmlFor="website-name">网站名称</label>
          <div className="website-create-row">
            <input
              id="website-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：我的企业网站"
              disabled={creating}
              autoFocus
            />
            <button className="primary-button" type="submit" disabled={creating}>
              {creating ? '正在创建…' : '创建网站'}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={creating}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="website-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="website-empty">正在加载…</p> : null}
      {!loading && websites.length === 0 ? (
        <p className="website-empty">还没有网站，创建你的第一个网站。</p>
      ) : null}
      <section className="website-list" aria-label="网站列表">
        {websites.map((website) => (
          <article className="website-card" key={website.id}>
            <div>
              <h2>{website.name}</h2>
              <p>创建于 {new Date(website.createdAt).toLocaleString('zh-CN')}</p>
            </div>
            <div className="website-card-status">
              <span className={`website-status website-status-${website.status}`}>
                {statusLabel(website.status)}
              </span>
              <span className="website-next-step">
                {website.status === 'ready'
                  ? '网站已准备，可以进入工作台'
                  : website.status === 'authorization_required'
                    ? '请先完成 PbootCMS 官方授权'
                    : '网站初始化将在下一阶段完成'}
              </span>
              {website.status === 'authorization_required' ? (
                <button
                  className="website-workbench-link"
                  type="button"
                  onClick={() => setAuthorizationWebsite(website)}
                >
                  配置授权
                </button>
              ) : null}
              {website.status === 'ready' || website.status === 'authorization_required' ? (
                <Link className="website-workbench-link" href={`/websites/${website.id}/agent`}>
                  {website.status === 'ready' ? '进入工作台' : '打开预览'}
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {authorizationWebsite ? (
        <div className="website-authorization-panel" role="dialog" aria-modal="true">
          <h2>PbootCMS 授权</h2>
          <p>当前预览地址：</p>
          <code>{authorizationWebsite.previewUrl}</code>
          <ol>
            <li>复制上面的预览地址。</li>
            <li>
              到{' '}
              <a href="http://www.pbootcms.com/freesn/" target="_blank" rel="noreferrer">
                PbootCMS 官方免费授权页
              </a>{' '}
              获取授权码。
            </li>
            <li>将官方返回的全部授权码粘贴到下方。</li>
          </ol>
          <form onSubmit={submitAuthorization}>
            <label htmlFor="pboot-authorization-code">授权码</label>
            <textarea
              id="pboot-authorization-code"
              value={authorizationCode}
              onChange={(event) => setAuthorizationCode(event.target.value)}
              maxLength={2048}
              disabled={authorizing}
              required
            />
            <button className="primary-button" type="submit" disabled={authorizing}>
              {authorizing ? '正在保存并验证…' : '保存并验证'}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setAuthorizationWebsite(null)}
              disabled={authorizing}
            >
              取消
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}
