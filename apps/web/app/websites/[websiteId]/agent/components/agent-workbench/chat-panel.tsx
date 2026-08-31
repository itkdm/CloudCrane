import { AlertTriangle } from 'lucide-react';
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
  return (
    <section className="chat-panel" aria-label="网站对话">
      <header className="chat-header">
        <span className="chat-session-label">当前对话</span>
        {running ? <span className="chat-context">处理中</span> : null}
      </header>
      {error ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{friendlyError(error)}</span>
          <button type="button" onClick={onDismissError} aria-label="关闭提示">
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

function friendlyError(error: string): string {
  if (/CLIENT_UNAVAILABLE|Preview Client|preview client/i.test(error))
    return '页面检查暂时不可用，请稍后重试';
  if (/PREVIEW_PROTOCOL_ERROR|preview protocol/i.test(error)) return '页面检查发生异常，请稍后重试';
  if (/timeout/i.test(error)) return '页面检查响应超时，请稍后重试';
  if (/connect|socket|Agent Service|disconnected|连接/i.test(error))
    return '连接已中断，正在重新连接';
  if (/INVALID_ARGUMENT|Website-relative path|路径/i.test(error)) return '暂不支持该页面路径';
  return '操作暂时未完成，请稍后重试';
}
