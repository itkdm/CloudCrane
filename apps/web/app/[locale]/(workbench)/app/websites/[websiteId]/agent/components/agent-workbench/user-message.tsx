import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Message } from './types';

export function UserMessage({ message }: { message: Message }) {
  const t = useTranslations('workbench');
  const isPending = message.status === 'pending';

  return (
    <article className={`user-message ${message.status ?? ''}`}>
      <div className="user-message-content">{message.text}</div>
      {isPending && (
        <LoaderCircle className="user-message-loader spin" size={14} aria-label={t('sending')} />
      )}
      {message.status === 'failed' && (
        <span className="user-message-failed">{t('sendFailed')}</span>
      )}
    </article>
  );
}
