'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, LayoutTemplate, Plus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  coverUrl: string | null;
  demoUrl: string | null;
  cmsType: string;
};

export function TemplatesView({
  onUseTemplate,
}: {
  onUseTemplate: (template: TemplateSummary) => void;
}) {
  const t = useTranslations('workspace');
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    fetch('/api/templates')
      .then(async (response) => {
        if (!response.ok) throw new Error('template catalog request failed');
        return (await response.json()) as TemplateSummary[];
      })
      .then((next) => {
        if (!active) return;
        setTemplates(next);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(
    () => ['all', ...new Set(templates.map((template) => template.category))],
    [templates],
  );
  const visibleTemplates =
    category === 'all' ? templates : templates.filter((template) => template.category === category);

  return (
    <main className="templates-view" aria-labelledby="templates-title">
      <header className="templates-header">
        <div>
          <h1 id="templates-title">{t('templatesTitle')}</h1>
        </div>
      </header>
      {status === 'loading' ? (
        <div className="templates-feedback" aria-busy="true">
          <Sparkles aria-hidden="true" />
          <span>{t('templatesLoading')}</span>
        </div>
      ) : status === 'error' ? (
        <div className="templates-feedback templates-feedback-error" role="alert">
          {t('templatesLoadError')}
        </div>
      ) : (
        <>
          <div className="templates-filters" aria-label={t('templatesCategories')}>
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={category === item ? 'templates-filter active' : 'templates-filter'}
                onClick={() => setCategory(item)}
              >
                {item === 'all' ? t('templatesAll') : item}
              </button>
            ))}
          </div>
          {visibleTemplates.length === 0 ? (
            <div className="templates-feedback">{t('templatesEmpty')}</div>
          ) : (
            <div className="template-grid">
              {visibleTemplates.map((template) => (
                <article className="template-card" key={template.id}>
                  <div className="template-card-cover">
                    {template.coverUrl ? (
                      <img src={template.coverUrl} alt="" />
                    ) : (
                      <LayoutTemplate aria-hidden="true" />
                    )}
                  </div>
                  <div className="template-card-body">
                    <span className="template-card-category">{template.category}</span>
                    <h2>{template.name}</h2>
                    <p>{template.description}</p>
                    <div className="template-card-actions">
                      {template.demoUrl ? (
                        <a href={template.demoUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink aria-hidden="true" />
                          {t('templatesPreview')}
                        </a>
                      ) : null}
                      <button type="button" onClick={() => onUseTemplate(template)}>
                        <Plus aria-hidden="true" />
                        {t('templatesUse')}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
