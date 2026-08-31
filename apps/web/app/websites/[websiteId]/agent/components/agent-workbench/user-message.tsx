import { LoaderCircle } from 'lucide-react';
import type { Message } from './types';

export function UserMessage({ message }: { message: Message }) {
  const isPending = message.status === 'pending';

  return (
    <article className={`user-message ${message.status ?? ''}`}>
      <div className="user-message-content">{message.text}</div>
      {isPending && (
        <LoaderCircle className="user-message-loader spin" size={14} aria-label="正在发送" />
      )}
      {message.status === 'failed' && <span className="user-message-failed">发送失败</span>}
    </article>
  );
}
