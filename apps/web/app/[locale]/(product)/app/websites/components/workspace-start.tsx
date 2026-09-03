'use client';

import { Check, ChevronDown, Folder, LoaderCircle, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Brand } from '@/components/layout/brand';

type Website = {
  id: string;
  name: string;
  status: string;
};

export function WorkspaceStart({
  websites,
  selectedWebsiteId,
  prompt,
  submitting,
  error,
  onWebsiteChange,
  onPromptChange,
  onSubmit,
  onAuthorizeWebsite,
}: {
  websites: Website[];
  selectedWebsiteId: string | null;
  prompt: string;
  submitting: boolean;
  error?: string;
  onWebsiteChange: (websiteId: string) => void;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onAuthorizeWebsite: (websiteId: string) => void;
}) {
  const t = useTranslations('workbench');
  const statusT = useTranslations('status');
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const selectedWebsite = websites.find((website) => website.id === selectedWebsiteId);
  const canSubmit = Boolean(prompt.trim() && selectedWebsite?.status === 'ready' && !submitting);

  useEffect(() => {
    if (!selectorOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setSelectorOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectorOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectorOpen]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <main className="workspace-start" aria-labelledby="workspace-start-title">
      <div className="workspace-start-header">
        <Brand />
        <p>{t('startSubtitle')}</p>
      </div>
      <form className="workspace-start-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="workspace-start-prompt">
          {t('startPromptLabel')}
        </label>
        <textarea
          id="workspace-start-prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder={t('startPromptPlaceholder')}
          disabled={submitting}
          autoFocus
        />
        <div className="workspace-start-toolbar">
          <div className="workspace-start-selector" ref={selectorRef}>
            <button
              type="button"
              className="workspace-start-selector-trigger"
              onClick={() => setSelectorOpen((open) => !open)}
              aria-expanded={selectorOpen}
              aria-haspopup="listbox"
            >
              <Folder size={15} aria-hidden="true" />
              <span>{selectedWebsite?.name ?? t('selectWebsite')}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {selectorOpen ? (
              <div className="workspace-start-selector-menu" role="listbox" aria-label={t('selectWebsite')}>
                {websites.map((website) => {
                  const ready = website.status === 'ready';
                  return (
                    <button
                      key={website.id}
                      type="button"
                      className="workspace-start-selector-option"
                      role="option"
                      aria-selected={website.id === selectedWebsiteId}
                      onClick={() => {
                        setSelectorOpen(false);
                        if (ready) onWebsiteChange(website.id);
                        else onAuthorizeWebsite(website.id);
                      }}
                    >
                      <span className="workspace-start-selector-option-name">{website.name}</span>
                      <span className={`workspace-start-selector-status ${ready ? 'ready' : ''}`}>
                        {ready ? (
                          website.id === selectedWebsiteId ? <Check size={14} aria-hidden="true" /> : null
                        ) : (
                          statusT(website.status)
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            type="submit"
            className="workspace-start-submit"
            disabled={!canSubmit}
            aria-label={t('send')}
            title={t('send')}
          >
            {submitting ? <LoaderCircle className="workspace-start-spinner" size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
          </button>
        </div>
      </form>
      {error ? <p className="workspace-start-error" role="alert">{error}</p> : null}
      <h1 id="workspace-start-title" className="sr-only">
        {t('startTitle')}
      </h1>
    </main>
  );
}
