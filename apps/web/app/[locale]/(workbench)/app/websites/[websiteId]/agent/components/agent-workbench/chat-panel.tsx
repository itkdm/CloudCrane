import { AlertTriangle, Eye, Settings } from 'lucide-react';
import type { AttachmentRef } from '@cloudcrane/agent-protocol';
import type { ModelPreset, ModelProfile } from '@/lib/agent-client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Composer } from './composer';
import { MessageList } from './message-list';
import type {
  ContextUsage,
  ConversationTurn,
  ManualMaintenanceItem,
  WorkbenchError,
} from './types';

type ChatPanelProps = {
  turns: ConversationTurn[];
  pendingPrompt?: string;
  sessionLoading?: boolean;
  draft: string;
  running: boolean;
  disabled?: boolean;
  error?: string | WorkbenchError;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onDismissError: () => void;
  onExample: (value: string) => void;
  previewOpen?: boolean;
  onPreviewToggle?: () => void;
  onSettingsOpen?: () => void;
  onInteractionRespond?: (
    interactionId: string,
    response: { type: 'option'; optionIndex: number } | { type: 'custom'; value: string },
  ) => void;
  onInteractionCancel?: (interactionId: string) => void;
  onReferenceUpload?: (interactionId: string, file: File) => Promise<void>;
  manualMaintenanceItems?: ManualMaintenanceItem[];
  manualMaintenanceRunning?: boolean;
  manualMaintenancePending?: boolean;
  onCompact?: () => void;
  contextUsage?: ContextUsage | null;
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

export function ChatPanel({
  turns,
  pendingPrompt,
  sessionLoading,
  draft,
  running,
  disabled,
  error,
  onDraftChange,
  onSubmit,
  onStop,
  onDismissError,
  onExample,
  previewOpen,
  onPreviewToggle,
  onSettingsOpen,
  onInteractionRespond,
  onInteractionCancel,
  onReferenceUpload,
  manualMaintenanceItems = [],
  manualMaintenanceRunning = false,
  manualMaintenancePending = false,
  onCompact,
  contextUsage,
  attachments = [],
  uploadingAttachmentNames = [],
  onAttachmentSelect,
  onAttachmentRemove,
  modelProfiles,
  modelCatalog,
  selectedModelProfileId,
  onModelProfileSelect,
  onModelProfileChange,
}: ChatPanelProps) {
  const t = useTranslations('workbench');
  const onDismissErrorRef = useRef(onDismissError);
  onDismissErrorRef.current = onDismissError;
  const transientNotice = isTransientNotice(error);

  useEffect(() => {
    if (!transientNotice) return;
    const timer = window.setTimeout(() => onDismissErrorRef.current(), 3500);
    return () => window.clearTimeout(timer);
  }, [transientNotice]);

  return (
    <section className="chat-panel" aria-label={t('chat')}>
      {onPreviewToggle || onSettingsOpen || onCompact ? (
        <div className="chat-toolbar">
          <ContextUsageIndicator usage={contextUsage} />
          {onSettingsOpen ? (
            <button
              type="button"
              className="preview-toggle-button"
              onClick={onSettingsOpen}
              aria-label={t('settings')}
              title={t('settings')}
            >
              <Settings size={15} aria-hidden="true" />
              <span>{t('settings')}</span>
            </button>
          ) : null}
          {onCompact ? (
            <button
              type="button"
              className="preview-toggle-button"
              onClick={onCompact}
              disabled={running || manualMaintenanceRunning || manualMaintenancePending || disabled}
              aria-label={t('compactContext')}
              title={t('compactContext')}
            >
              <span aria-hidden="true">↻</span>
              <span>{t('compactContext')}</span>
            </button>
          ) : null}
          {onPreviewToggle ? (
            <button
              type="button"
              className={`preview-toggle-button ${previewOpen ? 'active' : ''}`}
              onClick={onPreviewToggle}
              aria-label={previewOpen ? t('closePreview') : t('openPreview')}
              aria-pressed={previewOpen}
              title={previewOpen ? t('closePreview') : t('openPreview')}
            >
              <Eye size={15} aria-hidden="true" />
              <span>{t('preview')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div
          className={`error-banner${transientNotice ? ' notice' : ''}`}
          role={transientNotice ? 'status' : 'alert'}
          aria-live={transientNotice ? 'polite' : 'assertive'}
        >
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{friendlyError(error, t)}</span>
          <button type="button" onClick={onDismissError} aria-label={t('closeNotice')}>
            ×
          </button>
        </div>
      ) : null}
      <MessageList
        turns={turns}
        pendingPrompt={pendingPrompt}
        sessionLoading={sessionLoading}
        onExample={onExample}
        manualMaintenanceItems={manualMaintenanceItems}
        onInteractionRespond={onInteractionRespond}
        onInteractionCancel={onInteractionCancel}
        onReferenceUpload={onReferenceUpload}
      />
      <Composer
        draft={draft}
        running={running}
        disabled={disabled || manualMaintenanceRunning || manualMaintenancePending}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
        onStop={onStop}
        attachments={attachments}
        uploadingAttachmentNames={uploadingAttachmentNames}
        onAttachmentSelect={onAttachmentSelect}
        onAttachmentRemove={onAttachmentRemove}
        modelProfiles={modelProfiles}
        modelCatalog={modelCatalog}
        selectedModelProfileId={selectedModelProfileId}
        onModelProfileSelect={onModelProfileSelect}
        onModelProfileChange={onModelProfileChange}
      />
    </section>
  );
}

function isTransientNotice(error?: string | WorkbenchError): boolean {
  return (
    error === 'CONTEXT_COMPACTION_NOT_NEEDED' ||
    (typeof error !== 'string' && error?.code === 'CONTEXT_COMPACTION_NOT_NEEDED')
  );
}

function ContextUsageIndicator({ usage }: { usage?: ContextUsage | null }) {
  const t = useTranslations('workbench');
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const percent = usage?.percent;
  const displayPercent =
    percent === null || percent === undefined ? null : Math.max(0, Math.min(100, percent));
  const severity =
    displayPercent === null
      ? 'unknown'
      : displayPercent >= 90
        ? 'danger'
        : displayPercent >= 70
          ? 'warning'
          : 'normal';
  const label = t('contextUsageLabel', {
    used: formatTokens(usage?.tokens),
    max: formatTokens(usage?.contextWindow),
    percent: Math.round(displayPercent ?? 0),
  });

  useEffect(() => {
    if (displayPercent !== null) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadingTimedOut(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [displayPercent]);

  if (displayPercent === null && !loadingTimedOut) {
    const loadingLabel = t('contextUsageLoading');
    return (
      <div
        className={`context-usage ${severity}`}
        role="status"
        aria-live="polite"
        aria-label={loadingLabel}
        title={loadingLabel}
      >
        <span className="context-usage-loading" aria-hidden="true" />
      </div>
    );
  }

  const unavailableLabel =
    usage && (usage.tokens !== null || usage.contextWindow > 0)
      ? t('contextUsageUnknownLabel', {
          used: formatTokens(usage.tokens),
          max: formatTokens(usage.contextWindow),
        })
      : t('contextUsageUnavailable');

  if (displayPercent === null) {
    return (
      <div
        className="context-usage unknown unavailable"
        role="status"
        aria-live="polite"
        aria-label={unavailableLabel}
        title={unavailableLabel}
      >
        <span className="context-usage-label">{unavailableLabel}</span>
      </div>
    );
  }

  return (
    <div
      className={`context-usage ${severity}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="context-usage-label">{label}</span>
      <div
        className="context-usage-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(displayPercent === null ? {} : { 'aria-valuenow': displayPercent })}
      >
        <span style={{ width: displayPercent === null ? '0%' : `${displayPercent}%` }} />
      </div>
    </div>
  );
}

function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) return '?';
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(tokens >= 100_000 ? 0 : 1)}k`;
}

function friendlyError(error: string | WorkbenchError, t: (key: string) => string): string {
  if (typeof error === 'string') return friendlyLegacyError(error, t);
  const code = error.code ?? '';
  const message = error.message;
  if (code === 'CONTEXT_COMPACTION_NOT_NEEDED') return t('compactContextNotNeeded');
  if (/configured model does not support image attachments/i.test(message))
    return t('imageAttachmentsUnsupported');
  if (error.source === 'preview-explicit') return t('errorPreview');
  if (error.source === 'connection') return t('connectionInterrupted');
  if (/CLIENT_UNAVAILABLE|Preview Client|preview client/i.test(message)) return t('errorPreview');
  if (/PREVIEW_PROTOCOL_ERROR|preview protocol/i.test(message)) return t('errorPreview');
  if (/Preview response is not pending|Preview Client is not registered/i.test(message))
    return t('errorPreview');
  if (/timeout/i.test(message)) return t('timeoutPreview');
  if (/connect|socket|disconnected|连接/i.test(message)) return t('connectionInterrupted');
  if (code === 'INVALID_ARGUMENT' || /Website-relative path|路径/i.test(message))
    return t('unsupportedPath');
  return t('operationIncomplete');
}

function friendlyLegacyError(error: string, t: (key: string) => string): string {
  if (error === 'CONTEXT_COMPACTION_NOT_NEEDED') return t('compactContextNotNeeded');
  if (
    /CLIENT_UNAVAILABLE|Preview Client|preview client|PREVIEW_PROTOCOL_ERROR|preview protocol/i.test(
      error,
    )
  )
    return t('errorPreview');
  if (/Preview response is not pending|Preview Client is not registered/i.test(error))
    return t('errorPreview');
  if (/timeout/i.test(error)) return t('timeoutPreview');
  if (/connect|socket|disconnected|连接/i.test(error)) return t('connectionInterrupted');
  if (/INVALID_ARGUMENT|Website-relative path|路径/i.test(error)) return t('unsupportedPath');
  return t('operationIncomplete');
}
