'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { copyTextWithFallback, PBOOT_AUTHORIZATION_URL } from '@/lib/website-authorization';
import { isWebsiteStatus } from '@/lib/presentation/website-status';
import type { CreatedWebsite } from './website-create-dialog';

type WebsiteShare = {
  id: string;
  url?: string;
  expiresAt: string | number;
  revokedAt?: string | number | null;
};

const SHARE_DURATIONS = [
  { value: '1h', label: 'oneHour' },
  { value: '1d', label: 'oneDay' },
  { value: '7d', label: 'sevenDays' },
  { value: '30d', label: 'thirtyDays' },
] as const;

export function WebsiteSettingsDialog({
  website,
  onClose,
  onAuthorized,
  onTemplateRetried,
  onDeleteStart,
  onDeleted,
}: {
  website: CreatedWebsite | null;
  onClose: () => void;
  onAuthorized: () => void;
  onTemplateRetried: () => void;
  onDeleteStart: () => void;
  onDeleted: () => Promise<void>;
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
  const [retryingTemplate, setRetryingTemplate] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareDuration, setShareDuration] = useState<string>(SHARE_DURATIONS[1].value);
  const [shares, setShares] = useState<WebsiteShare[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [creatingShare, setCreatingShare] = useState(false);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  const [shareError, setShareError] = useState('');
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  const [, setShareClock] = useState(0);

  useEffect(() => {
    if (!confirmingDelete) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleting) {
        setConfirmingDelete(false);
        setError('');
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmingDelete, deleting]);

  useEffect(() => {
    if (!shareOpen || !website) return;
    let cancelled = false;
    setLoadingShares(true);
    setShareError('');
    void fetch(`/api/websites/${website.id}/shares`)
      .then(async (response) => {
        const payload = (await response.json()) as
          WebsiteShare[] | { shares?: WebsiteShare[]; error?: { message?: string } };
        if (!response.ok) {
          throw new Error(!Array.isArray(payload) ? payload.error?.message : undefined);
        }
        return Array.isArray(payload) ? payload : (payload.shares ?? []);
      })
      .then((nextShares) => {
        if (!cancelled) setShares(nextShares);
      })
      .catch((reason) => {
        if (!cancelled) {
          setShareError(reason instanceof Error ? reason.message : t('shareLoadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingShares(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareOpen, website, t]);

  useEffect(() => {
    if (!shareOpen) return;
    const timer = window.setInterval(() => setShareClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [shareOpen]);

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

  function openSharePanel() {
    setShareOpen((open) => !open);
    setShareError('');
  }

  async function createShare() {
    setCreatingShare(true);
    setShareError('');
    try {
      const response = await fetch(`/api/websites/${currentWebsite.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresIn: shareDuration }),
      });
      const payload = (await response.json()) as WebsiteShare | { error?: { message?: string } };
      if (!response.ok || !('id' in payload) || !payload.url) {
        throw new Error(('error' in payload && payload.error?.message) || t('shareCreateError'));
      }
      setShares((current) => [payload, ...current.filter((share) => share.id !== payload.id)]);
      if (await copyTextWithFallback(payload.url)) {
        setCopiedShareId(payload.id);
        window.setTimeout(() => setCopiedShareId(null), 1600);
      }
    } catch (reason) {
      setShareError(reason instanceof Error ? reason.message : t('shareCreateError'));
    } finally {
      setCreatingShare(false);
    }
  }

  async function copyShare(share: WebsiteShare) {
    if (share.url && (await copyTextWithFallback(share.url))) {
      setCopiedShareId(share.id);
      window.setTimeout(() => setCopiedShareId(null), 1600);
    } else {
      setShareError(t('copyError'));
    }
  }

  async function revokeShare(shareId: string) {
    setRevokingShareId(shareId);
    setShareError('');
    try {
      const response = await fetch(
        `/api/websites/${currentWebsite.id}/shares?shareId=${encodeURIComponent(shareId)}`,
        {
          method: 'DELETE',
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || t('shareRevokeError'));
      setShares((current) =>
        current.map((share) =>
          share.id === shareId ? { ...share, revokedAt: new Date().toISOString() } : share,
        ),
      );
    } catch (reason) {
      setShareError(reason instanceof Error ? reason.message : t('shareRevokeError'));
    } finally {
      setRevokingShareId(null);
    }
  }

  function shareState(share: WebsiteShare) {
    if (share.revokedAt) return 'revoked' as const;
    return new Date(share.expiresAt).getTime() <= Date.now()
      ? ('expired' as const)
      : ('active' as const);
  }

  async function retryTemplate() {
    setRetryingTemplate(true);
    setError('');
    try {
      const response = await fetch(`/api/websites/${currentWebsite.id}/template-attachment/retry`, {
        method: 'POST',
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || t('templateRetryError'));
      onTemplateRetried();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('templateRetryError'));
    } finally {
      setRetryingTemplate(false);
    }
  }

  async function deleteWebsite() {
    onDeleteStart();
    setDeleting(true);
    setError('');
    try {
      await onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('deleteError'));
      setDeleting(false);
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
          disabled={authorizing || deleting}
        >
          ×
        </button>
        <div className="website-settings-content">
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
              <div className="website-settings-preview-actions">
                {currentWebsite.previewUrl ? (
                  <button className="secondary-button" type="button" onClick={copyPreviewUrl}>
                    {copied ? common('copied') : t('copyAddress')}
                  </button>
                ) : null}
                <button className="secondary-button" type="button" onClick={openSharePanel}>
                  {shareOpen ? t('closeSharePreview') : t('sharePreview')}
                </button>
              </div>
            </div>

            {shareOpen ? (
              <div className="website-settings-share" aria-labelledby="website-share-title">
                <div className="website-settings-share-heading">
                  <div>
                    <h4 id="website-share-title">{t('sharePreview')}</h4>
                    <p>{t('sharePreviewDescription')}</p>
                  </div>
                </div>
                <div className="website-settings-share-create">
                  <label htmlFor="website-share-duration">{t('shareDuration')}</label>
                  <div className="website-settings-share-create-row">
                    <select
                      id="website-share-duration"
                      value={shareDuration}
                      onChange={(event) => setShareDuration(event.target.value)}
                      disabled={creatingShare}
                    >
                      {SHARE_DURATIONS.map((duration) => (
                        <option key={duration.value} value={duration.value}>
                          {t(duration.label)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void createShare()}
                      disabled={creatingShare || !currentWebsite.previewUrl}
                    >
                      {creatingShare ? t('creatingShare') : t('createShare')}
                    </button>
                  </div>
                </div>
                {shareError ? (
                  <p className="website-modal-error" role="alert">
                    {shareError}
                  </p>
                ) : null}
                <div className="website-settings-share-list">
                  <h4>{t('existingShares')}</h4>
                  {loadingShares ? (
                    <p className="website-settings-share-empty">{t('loadingShares')}</p>
                  ) : null}
                  {!loadingShares && shares.length === 0 ? (
                    <p className="website-settings-share-empty">{t('noShares')}</p>
                  ) : null}
                  {shares.map((share) => {
                    const state = shareState(share);
                    return (
                      <div className={`website-settings-share-item is-${state}`} key={share.id}>
                        <code>{share.url ?? t('shareLinkUnavailable')}</code>
                        <span>
                          {state === 'active'
                            ? t('shareExpiresAt', {
                                date: format.dateTime(new Date(share.expiresAt), {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                }),
                              })
                            : state === 'expired'
                              ? t('shareExpired')
                              : t('shareRevoked')}
                        </span>
                        <div className="website-settings-share-item-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => void copyShare(share)}
                            disabled={state !== 'active' || !share.url}
                          >
                            {copiedShareId === share.id ? common('copied') : t('copyShare')}
                          </button>
                          <button
                            className="secondary-button danger-button"
                            type="button"
                            onClick={() => void revokeShare(share.id)}
                            disabled={state !== 'active' || revokingShareId === share.id}
                          >
                            {revokingShareId === share.id ? t('revokingShare') : t('revokeShare')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {currentWebsite.status === 'authorization_required' ? (
              <form
                id="pboot-authorization-form"
                className="website-settings-authorization"
                onSubmit={submit}
              >
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
              </form>
            ) : null}
            {currentWebsite.status === 'template_attach_failed' ? (
              <div className="website-settings-authorization">
                <p>{t('templateAttachFailed')}</p>
                {error ? (
                  <p className="website-modal-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void retryTemplate()}
                  disabled={retryingTemplate}
                >
                  {retryingTemplate ? t('templateRetrying') : t('templateRetry')}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <div className={`website-settings-delete${confirmingDelete ? ' is-confirming' : ''}`}>
          {!confirmingDelete ? (
            <div
              className={`website-settings-actions${
                currentWebsite.status === 'authorization_required' ? ' has-authorization' : ''
              }`}
            >
              {currentWebsite.status === 'authorization_required' ? (
                <button
                  className="primary-button"
                  type="submit"
                  form="pboot-authorization-form"
                  disabled={authorizing}
                >
                  {authorizing ? t('verifying') : t('saveVerify')}
                </button>
              ) : null}
              <button
                className="secondary-button danger-button"
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={authorizing || retryingTemplate}
              >
                {t('deleteWebsite')}
              </button>
            </div>
          ) : (
            <div
              className="website-delete-confirmation"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="website-delete-confirm-title"
              aria-describedby="website-delete-confirm-description website-delete-confirm-warning"
            >
              <h4 id="website-delete-confirm-title">{t('confirmDeleteWebsite')}</h4>
              <p id="website-delete-confirm-description">
                {t('deleteWebsiteDescription', { name: currentWebsite.name })}
              </p>
              <p id="website-delete-confirm-warning">{t('deleteWebsiteWarning')}</p>
              {error ? (
                <p className="website-modal-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="website-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  autoFocus
                  onClick={() => {
                    setConfirmingDelete(false);
                    setError('');
                  }}
                  disabled={deleting}
                >
                  {common('cancel')}
                </button>
                <button
                  className="primary-button danger-button"
                  type="button"
                  onClick={() => void deleteWebsite()}
                  disabled={deleting}
                >
                  {deleting ? t('deletingWebsite') : t('confirmDeleteWebsite')}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
