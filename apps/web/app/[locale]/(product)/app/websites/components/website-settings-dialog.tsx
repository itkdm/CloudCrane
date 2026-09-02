'use client';

import { FormEvent, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { copyTextWithFallback, PBOOT_AUTHORIZATION_URL } from '@/lib/website-authorization';
import { isWebsiteStatus } from '@/lib/presentation/website-status';
import type { CreatedWebsite } from './website-create-dialog';

export function WebsiteSettingsDialog({
  website,
  onClose,
  onAuthorized,
}: {
  website: CreatedWebsite | null;
  onClose: () => void;
  onAuthorized: () => void;
}) {
  const t = useTranslations('websites');
  const statusT = useTranslations('status');
  const wt = useTranslations('workbench');
  const common = useTranslations('common');
  const format = useFormatter();
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  if (!website) return null;
  const currentWebsite = website;
  const statusKey = isWebsiteStatus(currentWebsite.status) ? currentWebsite.status : 'unknown';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthorizing(true);
    setError('');
    try {
      const response = await fetch(`/api/websites/${currentWebsite.id}/pboot-authorization`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sn: authorizationCode }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || t('authorizationError'));
      setAuthorizationCode('');
      onAuthorized();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('authorizationError'));
    } finally {
      setAuthorizing(false);
    }
  }

  async function copyPreviewUrl() {
    if (!currentWebsite.previewUrl) return;
    if (await copyTextWithFallback(currentWebsite.previewUrl)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      setError(t('copyError'));
    }
  }

  return (
    <div className="website-authorization-backdrop">
      <section
        className="website-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="website-settings-title"
      >
        <button
          className="website-authorization-close"
          type="button"
          aria-label={common('close')}
          onClick={onClose}
          disabled={authorizing}
        >
          ×
        </button>
        <h2 id="website-settings-title">{wt('settings')}</h2>

        <section className="website-settings-section" aria-labelledby="website-basic-title">
          <h3 id="website-basic-title">{t('basicInfo')}</h3>
          <dl className="website-settings-details">
            <div>
              <dt>{t('name')}</dt>
              <dd>{currentWebsite.name}</dd>
            </div>
            <div>
              <dt>{t('createdAtLabel')}</dt>
              <dd>
                {format.dateTime(new Date(currentWebsite.createdAt), {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </dd>
            </div>
            <div>
              <dt>{t('statusLabel')}</dt>
              <dd>
                <span className={`website-status website-status-${currentWebsite.status}`}>
                  {statusT(statusKey)}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <section className="website-settings-section" aria-labelledby="website-pboot-title">
          <h3 id="website-pboot-title">PbootCMS</h3>
          <div className="website-settings-row">
            <span>{t('authorizationStatus')}</span>
            <strong>
              {currentWebsite.status === 'ready' ? t('authorized') : statusT(statusKey)}
            </strong>
          </div>
          <div className="website-settings-row website-settings-preview">
            <span>{t('previewAddress')}</span>
            <code>{currentWebsite.previewUrl}</code>
            {currentWebsite.previewUrl ? (
              <button className="secondary-button" type="button" onClick={copyPreviewUrl}>
                {copied ? common('copied') : t('copyAddress')}
              </button>
            ) : null}
          </div>

          {currentWebsite.status === 'authorization_required' ? (
            <form className="website-settings-authorization" onSubmit={submit}>
              <p>{t('authorizationDescription')}</p>
              <p>
                {t('authorizationStepOne')}{' '}
                <a href={PBOOT_AUTHORIZATION_URL} target="_blank" rel="noopener noreferrer">
                  {t('officialAuthorization')}
                </a>
                。
              </p>
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
              {error ? (
                <p className="website-modal-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button className="primary-button" type="submit" disabled={authorizing}>
                {authorizing ? t('verifying') : t('saveVerify')}
              </button>
            </form>
          ) : null}
        </section>
      </section>
    </div>
  );
}
