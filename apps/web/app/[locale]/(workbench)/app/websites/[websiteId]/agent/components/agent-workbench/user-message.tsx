import { Check, CircleAlert, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { copyTextWithFallback } from '@/lib/website-authorization';
import type { Message } from './types';

export function UserMessage({ message }: { message: Message }) {
  const t = useTranslations('workbench');
  const common = useTranslations('common');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyMessage() {
    if (!message.text || !(await copyTextWithFallback(message.text))) return;
    setCopied(true);
  }

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
      <div className="user-message-main">
        <div className="user-message-content">{message.text}</div>
        {message.text ? (
          <div className="user-message-actions">
            <button
              className="message-action-button"
              type="button"
              onClick={() => void copyMessage()}
              aria-label={copied ? common('copied') : common('copy')}
              title={copied ? common('copied') : common('copy')}
            >
              {copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
