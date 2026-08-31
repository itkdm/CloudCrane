import { Sparkles } from 'lucide-react';
import { AssistantMessage } from './assistant-message';
import { useConversationScroll } from './conversation-scroll';
import { ToolExecution } from './tool-execution';
import { UserMessage } from './user-message';
import type { Message } from './types';

type MessageListProps = {
  messages: Message[];
  onExample: (value: string) => void;
};

const examples = ['修改首页标题和按钮', '调整页面配色', '优化导航栏布局'];

export function MessageList({ messages, onExample }: MessageListProps) {
  const contentVersion = messages.reduce(
    (version, message) =>
      version +
      1 +
      message.id.length +
      (message.text?.length ?? 0) +
      (message.toolInput?.length ?? 0) +
      (message.toolOutput?.length ?? 0) +
      (message.status?.length ?? 0),
    0,
  );
  const latestUserMessageId = messages.at(-1)?.role === 'user' ? messages.at(-1)?.id : undefined;
  const { containerRef, endRef, onScroll, returnToLatest, showReturnToLatest } =
    useConversationScroll(contentVersion, latestUserMessageId);

  return (
    <div ref={containerRef} className="message-list" onScroll={onScroll} aria-label="对话消息">
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">
            <Sparkles size={19} />
          </div>
          <h2>想先改什么？</h2>
          <p>
            告诉我希望修改的网站内容，
            <br />
            我会直接在当前网站中完成修改并检查结果。
          </p>
          <div className="example-prompts" aria-label="示例请求">
            {examples.map((example) => (
              <button type="button" key={example} onClick={() => onExample(example)}>
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : (
        messages
          .filter((message) => message.role !== 'tool' || Boolean(message.toolName))
          .map((message) => {
            if (message.role === 'assistant')
              return <AssistantMessage key={message.id} message={message} />;
            if (message.role === 'tool')
              return <ToolExecution key={message.id} message={message} />;
            return <UserMessage key={message.id} message={message} />;
          })
      )}
      <div ref={endRef} aria-hidden="true" />
      {showReturnToLatest ? (
        <button
          type="button"
          onClick={returnToLatest}
          aria-label="回到最新消息"
          title="回到最新消息"
          style={{
            position: 'sticky',
            bottom: 12,
            display: 'block',
            margin: '0 0 0 auto',
            border: '1px solid #c4ddd5',
            borderRadius: 999,
            padding: '7px 11px',
            background: '#ffffff',
            color: '#20645a',
            fontSize: 11,
            boxShadow: '0 4px 14px rgba(25, 62, 54, 0.12)',
          }}
        >
          回到最新消息
        </button>
      ) : null}
    </div>
  );
}
