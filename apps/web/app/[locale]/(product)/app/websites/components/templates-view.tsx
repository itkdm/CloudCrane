'use client';

import { useTranslations } from 'next-intl';

export function TemplatesView() {
  const t = useTranslations('workspace');

  return (
    <main className="workspace-empty-state">
      <div className="workspace-empty-state-inner">
        <span className="workspace-empty-state-eyebrow">CloudCrane</span>
        <h1>{t('templatesTitle')}</h1>
        <p>{t('templatesDescription')}</p>
        <a
          className="primary-button"
          href="https://muban.itkdm.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('openTemplateLibrary')}
        </a>
      </div>
    </main>
  );
}
