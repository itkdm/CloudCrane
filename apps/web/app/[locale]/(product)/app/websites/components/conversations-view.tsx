'use client';

import { useTranslations } from 'next-intl';

export function ConversationsView() {
  const t = useTranslations('workspace');

  return (
    <main className="workspace-empty-state">
      <div className="workspace-empty-state-inner">
        <span className="workspace-empty-state-eyebrow">CloudCrane</span>
        <h1>{t('conversationsTitle')}</h1>
        <p>{t('conversationsDescription')}</p>
      </div>
    </main>
  );
}
