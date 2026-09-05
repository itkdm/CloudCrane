import { AlertTriangle, Eye, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Composer } from './composer';
import { MessageList } from './message-list';
import type { ConversationTurn, ManualMaintenanceItem, WorkbenchError } from './types';

type ChatPanelProps = {
  turns: ConversationTurn[];
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
  manualMaintenanceItems?: ManualMaintenanceItem[];
  manualMaintenanceRunning?: boolean;
  onCompact?: () => void;
};

export function ChatPanel({
  turns,
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
  manualMaintenanceItems = [],
  manualMaintenanceRunning = false,
  onCompact,
}: ChatPanelProps) {
  const t = useTranslations('workbench');
  return (
    <section className="chat-panel" aria-label={t('chat')}>
      {onPreviewToggle || onSettingsOpen || onCompact ? (
        <div className="chat-toolbar">
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
              disabled={running || manualMaintenanceRunning || disabled}
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
          className={`error-banner${error === 'CONTEXT_COMPACTION_NOT_NEEDED' || (typeof error !== 'string' && error.code === 'CONTEXT_COMPACTION_NOT_NEEDED') ? ' notice' : ''}`}
          role="alert"
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
        onExample={onExample}
        manualMaintenanceItems={manualMaintenanceItems}
        onInteractionRespond={onInteractionRespond}
        onInteractionCancel={onInteractionCancel}
      />
      <Composer
        draft={draft}
        running={running}
        disabled={disabled || manualMaintenanceRunning}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
        onStop={onStop}
      />
    </section>
  );
}

function friendlyError(error: string | WorkbenchError, t: (key: string) => string): string {
  if (typeof error === 'string') return friendlyLegacyError(error, t);
  const code = error.code ?? '';
  const message = error.message;
  if (code === 'CONTEXT_COMPACTION_NOT_NEEDED') return t('compactContextNotNeeded');
  if (error.source === 'preview-explicit') return t('errorPreview');
  if (error.source === 'connection') return t('connectionInterrupted');
  if (/CLIENT_UNAVAILABLE|Preview Client|preview client/i.test(message)) return t('errorPreview');
  if (/PREVIEW_PROTOCOL_ERROR|preview protocol/i.test(message)) return t('errorPreview');
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
  if (/timeout/i.test(error)) return t('timeoutPreview');
  if (/connect|socket|disconnected|连接/i.test(error)) return t('connectionInterrupted');
  if (/INVALID_ARGUMENT|Website-relative path|路径/i.test(error)) return t('unsupportedPath');
  return t('operationIncomplete');
}
