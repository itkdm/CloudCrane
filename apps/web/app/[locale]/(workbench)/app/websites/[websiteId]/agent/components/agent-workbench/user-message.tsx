import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Message } from './types';

export function UserMessage({ message }: { message: Message }) {
  const t = useTranslations('workbench');

  return (
    <article className={`user-message ${message.status ?? ''}`}>
      {message.status === 'failed' && (
        <span
          className="user-message-failed"
          role="img"
          aria-label={t('sendFailed')}
          title={t('sendFailed')}
        >
          <CircleAlert size={15} aria-hidden="true" />
        </span>
      )}
      <div className="user-message-content">{message.text}</div>
    </article>
  );
}
