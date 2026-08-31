import { AlertTriangle } from 'lucide-react';
import { Composer } from './composer';
import { MessageList } from './message-list';
import type { Message } from './types';

type ChatPanelProps = {
  messages: Message[];
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
  messages,
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
    <section className="chat-panel" aria-label="AI 建站助手">
      <header className="chat-header">
        <div>
          <span className="section-kicker">网站工作台</span>
          <h1>AI 建站助手</h1>
        </div>
        <span className="chat-context">
          {running ? '正在操作当前网站' : '随时描述你的修改需求'}
        </span>
      </header>
      {error ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{friendlyError(error)}</span>
          <button type="button" onClick={onDismissError} aria-label="关闭提示">
            ×
          </button>
        </div>
      ) : (
        <div className="error-placeholder" aria-hidden="true" />
      )}
      <MessageList messages={messages} onExample={onExample} />
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
    return '预览暂时无法检查页面';
  if (/connect|socket|Agent Service/i.test(error)) return 'Agent 服务连接失败';
  if (/timeout/i.test(error)) return '操作响应超时，请稍后重试';
  return error;
}
