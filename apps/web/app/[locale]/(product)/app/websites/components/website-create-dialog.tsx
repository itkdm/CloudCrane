'use client';

import { FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';

export type CreatedWebsite = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  previewUrl?: string;
};

export function WebsiteCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (website: CreatedWebsite) => void;
}) {
  const t = useTranslations('websites');
  const common = useTranslations('common');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

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
      const payload = (await response.json()) as CreatedWebsite | { error?: { message?: string } };
      if (!response.ok || !('id' in payload)) {
        throw new Error(('error' in payload && payload.error?.message) || t('createError'));
      }
      setName('');
      onCreated(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('createError'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="website-dialog-backdrop">
      <section
        className="website-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="website-create-title"
      >
        <button
          className="website-dialog-close"
          type="button"
          aria-label={common('close')}
          onClick={onClose}
          disabled={creating}
        >
          ×
        </button>
        <h2 id="website-create-title">{t('create')}</h2>
        <form onSubmit={submit}>
          <label htmlFor="website-name">{t('name')}</label>
          <input
            id="website-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('namePlaceholder')}
            disabled={creating}
            autoFocus
            required
          />
          {error ? (
            <p className="website-modal-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="website-dialog-actions">
            <button className="primary-button" type="submit" disabled={creating}>
              {creating ? t('creating') : t('create')}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
              disabled={creating}
            >
              {common('cancel')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
