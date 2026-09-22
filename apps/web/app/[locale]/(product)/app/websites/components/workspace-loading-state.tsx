'use client';

import { useTranslations } from 'next-intl';

export function WorkspaceLoadingState() {
  const t = useTranslations('websites');

  return (
    <main className="workspace-loading-state" aria-busy="true" aria-live="polite">
      <div className="workspace-loading-card">
        <div className="workspace-loading-copy">
          <h1>{t('loading')}</h1>
        </div>
        <div className="workspace-loading-progress" aria-hidden="true">
          <span />
        </div>
        <div className="workspace-loading-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </main>
  );
}
