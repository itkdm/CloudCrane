import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LoaderCircle } from 'lucide-react';
import type { Message } from './types';

export const AssistantMessage = memo(function AssistantMessage({ message }: { message: Message }) {
  const isStreaming =
    message.status === 'running' || message.status === 'streaming' || !message.text;

  return (
    <article className="assistant-message">
      <div className="message-avatar" aria-hidden="true">
        CC
      </div>
      <div
        className="message-body markdown-body"
        {...(isStreaming ? { role: 'status', 'aria-live': 'polite' as const } : {})}
      >
        {message.text ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        ) : (
          <div className="message-streaming" aria-label="正在生成回复">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在生成回复…</span>
          </div>
        )}
      </div>
    </article>
  );
});
