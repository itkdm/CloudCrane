import { ChevronDown, LoaderCircle, Paperclip, Send, Square, X } from 'lucide-react';
import type { AttachmentRef } from '@cloudcrane/agent-protocol';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ModelProfile } from '@/lib/agent-client';
import { createModelProfile, deleteModelProfile } from '@/lib/agent-client';

type ComposerProps = {
  draft: string;
  running: boolean;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  attachments?: AttachmentRef[];
  uploadingAttachmentNames?: string[];
  onAttachmentSelect?: (files: File[]) => void;
  onAttachmentRemove?: (id: string) => void;
  modelProfiles?: ModelProfile[];
  selectedModelProfileId?: string;
  onModelProfileSelect?: (id: string) => void;
  onModelProfileChange?: (profiles: ModelProfile[]) => void;
};

export function Composer({
  draft,
  running,
  disabled,
  onDraftChange,
  onSubmit,
  onStop,
  attachments = [],
  uploadingAttachmentNames = [],
  onAttachmentSelect,
  onAttachmentRemove,
  modelProfiles = [],
  selectedModelProfileId,
  onModelProfileSelect,
  onModelProfileChange,
}: ComposerProps) {
  const t = useTranslations('workbench');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [modelError, setModelError] = useState<string>();
  const [form, setForm] = useState({
    providerId: 'openai-compatible',
    modelId: '',
    baseUrl: '',
    apiKey: '',
    displayName: '',
  });
  const selectedModel =
    modelProfiles.find((profile) => profile.id === selectedModelProfileId) ??
    modelProfiles.find((profile) => profile.isDefault);
  const canSubmit = !running && !disabled && Boolean(selectedModel);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 28), 176)}px`;
  }, [draft]);

  return (
    <div className="composer-wrap">
      <div className="composer-box">
        {attachments.length > 0 || uploadingAttachmentNames.length > 0 ? (
          <div
            className="composer-attachments"
            aria-label={
              uploadingAttachmentNames.length > 0 ? t('attachmentUploading') : 'Attachments'
            }
            aria-live="polite"
          >
            {uploadingAttachmentNames.map((name, index) => (
              <span className="composer-attachment is-uploading" key={`uploading-${name}-${index}`}>
                <LoaderCircle className="spin" size={13} aria-hidden="true" />
                <span>{name}</span>
              </span>
            ))}
            {attachments.map((attachment) => (
              <span className="composer-attachment" key={attachment.id}>
                <span>{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => onAttachmentRemove?.(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={(event) => {
            const isComposing =
              isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229;
            if (
              isComposing ||
              event.key !== 'Enter' ||
              event.shiftKey ||
              !canSubmit ||
              !draft.trim()
            )
              return;
            event.preventDefault();
            onSubmit();
          }}
          placeholder={t('promptPlaceholder')}
          aria-label={t('promptLabel')}
          id="agent-prompt"
          name="prompt"
          rows={1}
          disabled={!canSubmit}
        />
        <div className="composer-toolbar">
          <div className="composer-model">
            <button
              type="button"
              className="composer-model-trigger"
              onClick={() => {
                setAddOpen(false);
                setModelMenuOpen((open) => !open);
              }}
              disabled={running}
            >
              <span>{selectedModel?.displayName ?? t('model')}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {modelMenuOpen ? (
              <div className="composer-model-menu" role="menu">
                {modelProfiles.map((profile) => (
                  <div className="composer-model-row" key={profile.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onModelProfileSelect?.(profile.id);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span>{profile.displayName}</span>
                      <small>
                        {profile.providerId}/{profile.modelId}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="composer-model-delete"
                      aria-label={t('deleteModel')}
                      onClick={async () => {
                        await deleteModelProfile(profile.id);
                        const next = modelProfiles.filter((item) => item.id !== profile.id);
                        onModelProfileChange?.(next);
                        if (selectedModelProfileId === profile.id)
                          onModelProfileSelect?.(next[0]?.id ?? '');
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {modelProfiles.length === 0 ? (
                  <div className="composer-model-empty">{t('noModels')}</div>
                ) : null}
                <button
                  type="button"
                  className="composer-model-add"
                  onClick={() => {
                    setAddOpen(true);
                    setModelMenuOpen(false);
                    setModelError(undefined);
                  }}
                >
                  {t('addModel')}
                </button>
              </div>
            ) : null}
            {addOpen ? (
              <form
                className="composer-model-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setModelError(undefined);
                  setSavingModel(true);
                  try {
                    const result = await createModelProfile({
                      providerKind: 'openai-compatible',
                      providerId: form.providerId,
                      modelId: form.modelId,
                      baseUrl: form.baseUrl || undefined,
                      apiKey: form.apiKey,
                      displayName: form.displayName || undefined,
                      api: 'openai-completions',
                      isDefault: modelProfiles.length === 0,
                    });
                    const next = [
                      ...modelProfiles
                        .filter((item) => item.id !== result.profile.id)
                        .map((item) =>
                          result.profile.isDefault ? { ...item, isDefault: false } : item,
                        ),
                      result.profile,
                    ];
                    onModelProfileChange?.(next);
                    onModelProfileSelect?.(result.profile.id);
                    setForm({
                      providerId: 'openai-compatible',
                      modelId: '',
                      baseUrl: '',
                      apiKey: '',
                      displayName: '',
                    });
                    setAddOpen(false);
                    setModelMenuOpen(false);
                  } catch (error) {
                    setModelError(error instanceof Error ? error.message : t('modelProfileFailed'));
                  } finally {
                    setSavingModel(false);
                  }
                }}
              >
                <strong>{t('addModel')}</strong>
                <select
                  name="providerId"
                  value={form.providerId}
                  onChange={(e) => setForm({ ...form, providerId: e.target.value })}
                >
                  <option value="openai-compatible">{t('providerOpenAiCompatible')}</option>
                </select>
                <input
                  required
                  name="modelId"
                  placeholder={t('modelName')}
                  value={form.modelId}
                  onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                />
                <input
                  required
                  type="url"
                  name="baseUrl"
                  placeholder={t('baseUrl')}
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
                <input
                  required
                  type="password"
                  name="apiKey"
                  autoComplete="new-password"
                  placeholder={t('apiKey')}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
                <input
                  name="displayName"
                  placeholder={t('model')}
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
                {modelError ? <small className="composer-model-error">{modelError}</small> : null}
                <div>
                  <button type="button" onClick={() => setAddOpen(false)}>
                    {t('cancel')}
                  </button>
                  <button type="submit" disabled={savingModel}>
                    {savingModel ? t('savingModel') : t('saveModel')}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
          <label className="composer-attach" title="Add attachment">
            <Paperclip size={16} aria-hidden="true" />
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,.txt,.md,.markdown"
              disabled={!canSubmit || !onAttachmentSelect}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length) onAttachmentSelect?.(files);
                event.target.value = '';
              }}
            />
          </label>
          {running ? (
            <button
              className="composer-send stop"
              type="button"
              onClick={onStop}
              aria-label={t('stop')}
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
              <span>{t('stop')}</span>
            </button>
          ) : (
            <button
              className="composer-send"
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || !draft.trim()}
              aria-label={t('send')}
            >
              {disabled ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
              <span>{t('send')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
