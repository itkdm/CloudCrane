import { ChevronDown, LoaderCircle, Paperclip, Send, Square, X } from 'lucide-react';
import type { AttachmentRef } from '@cloudcrane/agent-protocol';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ModelPreset, ModelProfile } from '@/lib/agent-client';
import { createModelProfile, deleteModelProfile, updateModelProfile } from '@/lib/agent-client';

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
  modelCatalog?: ModelPreset[];
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
  modelCatalog = [],
  selectedModelProfileId,
  onModelProfileSelect,
  onModelProfileChange,
}: ComposerProps) {
  const t = useTranslations('workbench');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelPopoverRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string>();
  const [savingModel, setSavingModel] = useState(false);
  const [modelError, setModelError] = useState<string>();
  const [form, setForm] = useState({
    presetId: 'custom-openai-compatible',
    providerId: 'custom',
    providerName: '',
    modelId: '',
    baseUrl: '',
    apiKey: '',
    input: ['text'] as Array<'text' | 'image'>,
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 16384,
  });
  const selectedPreset = modelCatalog.find((preset) => preset.id === form.presetId);
  const selectedPresetModel = selectedPreset?.models.find((model) => model.id === form.modelId);
  const selectedModel =
    modelProfiles.find((profile) => profile.id === selectedModelProfileId) ??
    modelProfiles.find((profile) => profile.isDefault);
  const attachmentUploadInProgress = uploadingAttachmentNames.length > 0;
  const canSubmit = !running && !disabled && !attachmentUploadInProgress && Boolean(selectedModel);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 28), 176)}px`;
  }, [draft]);

  useEffect(() => {
    if (!modelMenuOpen && !addOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && modelPopoverRef.current?.contains(target)) return;
      setModelMenuOpen(false);
      setAddOpen(false);
      setEditingProfileId(undefined);
      setModelError(undefined);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [addOpen, modelMenuOpen]);

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
          disabled={disabled}
        />
        <div className="composer-toolbar">
          <div ref={modelPopoverRef} className="composer-model">
            <button
              type="button"
              className="composer-model-trigger"
              onClick={() => {
                setAddOpen(false);
                setModelMenuOpen((open) => !open);
              }}
              disabled={running || disabled}
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
                    </button>
                    <div className="composer-model-actions">
                      <button
                        type="button"
                        className="composer-model-edit"
                        aria-label={t('editModel')}
                        onClick={() => {
                          setEditingProfileId(profile.id);
                          setForm({
                            presetId: profile.presetId ?? 'custom-openai-compatible',
                            providerId: profile.presetId ? profile.providerId : 'custom',
                            providerName: profile.providerName,
                            modelId: profile.modelId,
                            baseUrl: profile.baseUrl ?? '',
                            apiKey: '',
                            input: profile.input,
                            reasoning: profile.reasoning,
                            contextWindow: profile.contextWindow,
                            maxTokens: profile.maxTokens,
                          });
                          setModelMenuOpen(false);
                          setAddOpen(true);
                          setModelError(undefined);
                        }}
                      >
                        {t('editModel')}
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
                  </div>
                ))}
                {modelProfiles.length === 0 ? (
                  <div className="composer-model-empty">{t('noModels')}</div>
                ) : null}
                <button
                  type="button"
                  className="composer-model-add"
                  onClick={() => {
                    setEditingProfileId(undefined);
                    setForm({
                      presetId: 'custom-openai-compatible',
                      providerId: 'custom',
                      providerName: '',
                      modelId: '',
                      baseUrl: '',
                      apiKey: '',
                      input: ['text'],
                      reasoning: false,
                      contextWindow: 128000,
                      maxTokens: 16384,
                    });
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
                    const input = {
                      providerKind: 'openai-compatible' as const,
                      presetId: form.presetId || undefined,
                      providerId: form.providerId,
                      providerName: form.providerName,
                      modelId: form.modelId,
                      baseUrl: selectedPreset ? undefined : form.baseUrl || undefined,
                      api: selectedPreset?.api ?? 'openai-completions',
                      input: selectedPresetModel?.input ?? form.input,
                      reasoning: selectedPresetModel?.reasoning ?? form.reasoning,
                      contextWindow: selectedPresetModel?.contextWindow ?? form.contextWindow,
                      maxTokens: selectedPresetModel?.maxTokens ?? form.maxTokens,
                      ...(form.apiKey ? { apiKey: form.apiKey } : {}),
                    };
                    const result = editingProfileId
                      ? await updateModelProfile(editingProfileId, input)
                      : await createModelProfile({
                          ...input,
                          apiKey: form.apiKey,
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
                    setEditingProfileId(undefined);
                    setForm({
                      presetId: 'custom-openai-compatible',
                      providerId: 'custom',
                      providerName: '',
                      modelId: '',
                      baseUrl: '',
                      apiKey: '',
                      input: ['text'],
                      reasoning: false,
                      contextWindow: 128000,
                      maxTokens: 16384,
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
                <strong>{editingProfileId ? t('editModel') : t('addModel')}</strong>
                <select
                  name="presetId"
                  value={form.presetId}
                  onChange={(e) => {
                    const preset = modelCatalog.find((item) => item.id === e.target.value);
                    setForm({
                      ...form,
                      presetId: e.target.value,
                      providerId: preset?.providerId ?? 'custom',
                      providerName: preset?.providerName ?? '',
                      modelId: preset?.models[0]?.id ?? '',
                      baseUrl: preset?.baseUrl ?? '',
                      input: preset?.models[0]?.input ?? ['text'],
                      reasoning: preset?.models[0]?.reasoning ?? false,
                      contextWindow: preset?.models[0]?.contextWindow ?? 128000,
                      maxTokens: preset?.models[0]?.maxTokens ?? 16384,
                    });
                  }}
                >
                  <option value="" disabled>
                    {t('selectProvider')}
                  </option>
                  {modelCatalog.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.providerName}
                    </option>
                  ))}
                  <option value="custom-openai-compatible">{t('providerCustom')}</option>
                </select>
                {selectedPreset ? (
                  <>
                    <input
                      required
                      list="model-preset-options"
                      name="modelId"
                      placeholder={t('modelName')}
                      value={form.modelId}
                      onChange={(e) => {
                        const modelId = e.target.value;
                        const knownModel = selectedPreset?.models.find(
                          (model) => model.id === modelId,
                        );
                        setForm({
                          ...form,
                          modelId,
                          ...(!knownModel
                            ? {
                                input: ['text'],
                                reasoning: false,
                                contextWindow: 128000,
                                maxTokens: 16384,
                              }
                            : {}),
                        });
                      }}
                    />
                    <datalist id="model-preset-options">
                      {selectedPreset.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </datalist>
                    <small className="composer-model-auto-config">{selectedPreset.baseUrl}</small>
                    {selectedPresetModel ? (
                      <div
                        className="composer-model-capabilities"
                        aria-label={t('modelCapabilities')}
                      >
                        <span>
                          {t('inputCapability')}: {selectedPresetModel.input.join('、')}
                        </span>
                        <span>
                          {t('reasoningCapability')}:{' '}
                          {selectedPresetModel.reasoning ? t('supported') : t('unsupported')}
                        </span>
                        <span>
                          {t('contextWindow')}: {selectedPresetModel.contextWindow.toLocaleString()}
                        </span>
                        <span>
                          {t('maxOutputTokens')}: {selectedPresetModel.maxTokens.toLocaleString()}
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <small className="composer-model-auto-config">
                      {t('providerOpenAiCompatible')}
                    </small>
                    <input
                      required
                      name="providerName"
                      placeholder={t('providerName')}
                      value={form.providerName}
                      onChange={(e) => setForm({ ...form, providerName: e.target.value })}
                    />
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
                  </>
                )}
                {!selectedPresetModel ? (
                  <div className="composer-model-capability-fields">
                    <span>{t('inputCapability')}</span>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.input.includes('text')}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            input: (e.target.checked
                              ? [...new Set([...form.input, 'text'])]
                              : form.input.filter((item) => item !== 'text')) as Array<
                              'text' | 'image'
                            >,
                          })
                        }
                      />{' '}
                      {t('textInput')}
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.input.includes('image')}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            input: (e.target.checked
                              ? [...new Set([...form.input, 'image'])]
                              : form.input.filter((item) => item !== 'image')) as Array<
                              'text' | 'image'
                            >,
                          })
                        }
                      />{' '}
                      {t('imageInput')}
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.reasoning}
                        onChange={(e) => setForm({ ...form, reasoning: e.target.checked })}
                      />{' '}
                      {t('reasoningCapability')}
                    </label>
                    <label>
                      {t('contextWindow')}
                      <input
                        type="number"
                        min={1024}
                        step={1024}
                        value={form.contextWindow}
                        onChange={(e) =>
                          setForm({ ...form, contextWindow: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      {t('maxOutputTokens')}
                      <input
                        type="number"
                        min={1}
                        step={1024}
                        value={form.maxTokens}
                        onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                ) : null}
                <input
                  required={!editingProfileId}
                  type="password"
                  name="apiKey"
                  autoComplete="new-password"
                  placeholder={t('apiKey')}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
                {modelError ? <small className="composer-model-error">{modelError}</small> : null}
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProfileId(undefined);
                      setAddOpen(false);
                    }}
                  >
                    {t('cancel')}
                  </button>
                  <button type="submit" disabled={savingModel}>
                    {savingModel
                      ? t('savingModel')
                      : editingProfileId
                        ? t('updateModel')
                        : t('saveModel')}
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
              disabled={disabled || attachmentUploadInProgress || !onAttachmentSelect}
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
