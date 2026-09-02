import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Composer } from './composer';
import { MessageList } from './message-list';
import type { ConversationTurn } from './types';

type ChatPanelProps = {
  turns: ConversationTurn[];
  draft: string;
  running: boolean;
  disabled?: boolean;
  error?: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onDismissError: () => void;
  onExample: (value: string) => void;
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
}: ChatPanelProps) {
  const t = useTranslations('workbench');
  return (
    <section className="chat-panel" aria-label={t('chat')}>
      {error ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{friendlyError(error, t)}</span>
          <button type="button" onClick={onDismissError} aria-label={t('closeNotice')}>
            ×
          </button>
        </div>
      ) : null}
      <MessageList turns={turns} onExample={onExample} />
      <Composer
        draft={draft}
        running={running}
        disabled={disabled}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
        onStop={onStop}
      />
    </section>
  );
}

function friendlyError(error: string, t: (key: string) => string): string {
  if (/CLIENT_UNAVAILABLE|Preview Client|preview client/i.test(error)) return t('errorPreview');
  if (/PREVIEW_PROTOCOL_ERROR|preview protocol/i.test(error)) return t('errorPreview');
  if (/timeout/i.test(error)) return t('timeoutPreview');
  if (/connect|socket|Agent Service|disconnected|连接/i.test(error))
    return t('connectionInterrupted');
  if (/INVALID_ARGUMENT|Website-relative path|路径/i.test(error)) return t('unsupportedPath');
  return t('operationIncomplete');
}
