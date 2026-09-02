'use client';

import { FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import { copyTextWithFallback, PBOOT_AUTHORIZATION_URL } from '@/lib/website-authorization';
import type { CreatedWebsite } from './website-create-dialog';

export function WebsiteAuthorizationDialog({
  website,
  onClose,
  onAuthorized,
}: {
  website: CreatedWebsite | null;
  onClose: () => void;
  onAuthorized: () => void;
}) {
  const t = useTranslations('websites');
  const common = useTranslations('common');
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  if (!website) return null;
  const currentWebsite = website;

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
        className="website-authorization-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pboot-authorization-title"
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
        <h2 id="pboot-authorization-title">{t('authorizationTitle')}</h2>
        <p>{t('authorizationDescription')}</p>
        <div className="website-preview-url">
          <span>{t('previewAddress')}</span>
          <code>{currentWebsite.previewUrl}</code>
          <button className="secondary-button" type="button" onClick={copyPreviewUrl}>
            {copied ? common('copied') : t('copyAddress')}
          </button>
        </div>
        <ol>
          <li>{t('authorizationStepOne')}</li>
          <li>
            <a href={PBOOT_AUTHORIZATION_URL} target="_blank" rel="noopener noreferrer">
              {t('officialAuthorization')}
            </a>
          </li>
          <li>{t('authorizationStepThree')}</li>
        </ol>
        <form onSubmit={submit}>
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
          <div className="website-authorization-actions">
            <button className="primary-button" type="submit" disabled={authorizing}>
              {authorizing ? t('verifying') : t('saveVerify')}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
              disabled={authorizing}
            >
              {t('later')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
