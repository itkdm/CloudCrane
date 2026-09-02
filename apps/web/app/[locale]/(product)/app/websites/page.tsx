'use client';

import { Link } from '../../../../../i18n/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { FormEvent, useEffect, useState } from 'react';
import {
  copyTextWithFallback,
  PBOOT_AUTHORIZATION_URL,
} from '../../../../../lib/website-authorization';
import { isWebsiteStatus } from '../../../../../lib/presentation/website-status';
import './websites.css';

type Website = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  previewUrl?: string;
};

function statusLabel(status: string, t: (key: string) => string): string {
  return t(isWebsiteStatus(status) ? status : 'unknown');
}

export default function WebsitesPage() {
  const t = useTranslations('websites');
  const common = useTranslations('common');
  const status = useTranslations('status');
  const format = useFormatter();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [authorizationWebsite, setAuthorizationWebsite] = useState<Website | null>(null);
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [authorizationError, setAuthorizationError] = useState('');
  const [authorizationSuccess, setAuthorizationSuccess] = useState('');
  const [copiedPreviewUrl, setCopiedPreviewUrl] = useState(false);

  useEffect(() => {
    fetch('/api/websites')
      .then(async (response) => {
        if (!response.ok) throw new Error(t('loadError'));
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
        throw new Error(('error' in payload && payload.error?.message) || t('createError'));
      }
      setWebsites((current) => [payload, ...current]);
      setName('');
      setFormOpen(false);
      if (payload.status === 'authorization_required') {
        setAuthorizationWebsite(payload);
        setAuthorizationCode('');
        setAuthorizationError('');
        setCopiedPreviewUrl(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('createError'));
    } finally {
      setCreating(false);
    }
  }

  async function submitAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorizationWebsite) return;
    setAuthorizing(true);
    setAuthorizationError('');
    setAuthorizationSuccess('');
    try {
      const response = await fetch(`/api/websites/${authorizationWebsite.id}/pboot-authorization`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sn: authorizationCode }),
      });
      const payload = (await response.json()) as { status?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || t('authorizationError'));
      setWebsites((current) =>
        current.map((website) =>
          website.id === authorizationWebsite.id
            ? { ...website, status: payload.status ?? 'ready' }
            : website,
        ),
      );
      setAuthorizationCode('');
      setAuthorizationWebsite(null);
      setAuthorizationSuccess(t('authorizationSuccess'));
    } catch (reason) {
      setAuthorizationError(reason instanceof Error ? reason.message : t('authorizationError'));
    } finally {
      setAuthorizing(false);
    }
  }

  function openAuthorization(website: Website) {
    setAuthorizationWebsite(website);
    setAuthorizationCode('');
    setAuthorizationError('');
    setCopiedPreviewUrl(false);
  }

  async function copyPreviewUrl() {
    if (!authorizationWebsite?.previewUrl) return;
    const copied = await copyTextWithFallback(authorizationWebsite.previewUrl);
    if (copied) {
      setCopiedPreviewUrl(true);
      window.setTimeout(() => setCopiedPreviewUrl(false), 1600);
    } else {
      setAuthorizationError(t('copyError'));
    }
  }

  function closeAuthorization() {
    if (authorizing) return;
    setAuthorizationWebsite(null);
    setAuthorizationCode('');
    setAuthorizationError('');
    setCopiedPreviewUrl(false);
  }

  return (
    <main className="websites-page">
      <header className="websites-header">
        <div>
          <p className="websites-eyebrow">CloudCrane · 筑云鹤</p>
          <h1>{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => setFormOpen((open) => !open)}
        >
          {t('create')}
        </button>
      </header>

      {formOpen ? (
        <form className="website-create-form" onSubmit={submit}>
          <label htmlFor="website-name">{t('name')}</label>
          <div className="website-create-row">
            <input
              id="website-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('namePlaceholder')}
              disabled={creating}
              autoFocus
            />
            <button className="primary-button" type="submit" disabled={creating}>
              {creating ? t('creating') : t('create')}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={creating}
            >
              {common('cancel')}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="website-error" role="alert">
          {error}
        </p>
      ) : null}
      {authorizationSuccess ? (
        <p className="website-success" role="status">
          {authorizationSuccess}
        </p>
      ) : null}
      {loading ? <p className="website-empty">{t('loading')}</p> : null}
      {!loading && websites.length === 0 ? <p className="website-empty">{t('empty')}</p> : null}
      <section className="website-list" aria-label={t('listLabel')}>
        {websites.map((website) => (
          <article className="website-card" key={website.id}>
            <div>
              <h2>{website.name}</h2>
              <p>
                {t('createdAt', {
                  date: format.dateTime(new Date(website.createdAt), {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  }),
                })}
              </p>
            </div>
            <div className="website-card-status">
              <span className={`website-status website-status-${website.status}`}>
                {statusLabel(website.status, status)}
              </span>
              <span className="website-next-step">
                {website.status === 'ready'
                  ? t('nextReady')
                  : website.status === 'authorization_required'
                    ? t('nextAuthorization')
                    : t('nextProvisioning')}
              </span>
              {website.status === 'authorization_required' ? (
                <button
                  className="website-workbench-link"
                  type="button"
                  onClick={() => openAuthorization(website)}
                >
                  {t('authorizationSetup')}
                </button>
              ) : null}
              {website.status === 'ready' || website.status === 'authorization_required' ? (
                <Link className="website-workbench-link" href={`/app/websites/${website.id}/agent`}>
                  {website.status === 'ready' ? t('openWorkbench') : t('openPreview')}
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {authorizationWebsite ? (
        <div className="website-authorization-backdrop">
          <section
            className="website-authorization-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pboot-authorization-title"
          >
            <button
              className="website-authorization-close"
              type="button"
              aria-label={common('close')}
              onClick={closeAuthorization}
              disabled={authorizing}
            >
              ×
            </button>
            <h2 id="pboot-authorization-title">{t('authorizationTitle')}</h2>
            <p>{t('authorizationDescription')}</p>
            <div className="website-preview-url">
              <span>{t('previewAddress')}</span>
              <code>{authorizationWebsite.previewUrl}</code>
              <button className="secondary-button" type="button" onClick={copyPreviewUrl}>
                {copiedPreviewUrl ? t('common.copied') : t('copyAddress')}
              </button>
            </div>
            <ol>
              <li>{t('authorizationStepOne')}</li>
              <li>
                到{' '}
                <a href={PBOOT_AUTHORIZATION_URL} target="_blank" rel="noopener noreferrer">
                  {t('officialAuthorization')}
                </a>{' '}
                获取授权码。
              </li>
              <li>{t('authorizationStepThree')}</li>
            </ol>
            <form onSubmit={submitAuthorization}>
              <label htmlFor="pboot-authorization-code">{t('authorizationCode')}</label>
              <textarea
                id="pboot-authorization-code"
                value={authorizationCode}
                onChange={(event) => setAuthorizationCode(event.target.value)}
                placeholder={t('authorizationPlaceholder')}
                maxLength={2048}
                disabled={authorizing}
                required
              />
              {authorizationError ? (
                <p className="website-modal-error" role="alert">
                  {authorizationError}
                </p>
              ) : null}
              <div className="website-authorization-actions">
                <button className="primary-button" type="submit" disabled={authorizing}>
                  {authorizing ? t('verifying') : t('saveVerify')}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeAuthorization}
                  disabled={authorizing}
                >
                  {t('later')}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
