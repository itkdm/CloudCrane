import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LoaderCircle } from 'lucide-react';
import type { Message } from './types';

export function AssistantMessage({ message }: { message: Message }) {
  return (
    <article className="assistant-message">
      <div className="message-avatar" aria-hidden="true">
        CC
      </div>
      <div className="message-body markdown-body">
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
}
