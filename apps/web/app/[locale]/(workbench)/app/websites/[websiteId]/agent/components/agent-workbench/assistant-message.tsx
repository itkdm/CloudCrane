import { memo, type ComponentProps, useEffect, useState } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { copyTextWithFallback } from '@/lib/website-authorization';
import type { Message } from './types';

type AssistantMessageProps = { message: Message; variant?: 'final' | 'narrative' };

type MarkdownTableProps = ComponentProps<'table'> & ExtraProps;

const MarkdownTable = ({ children, node, ...props }: MarkdownTableProps) => {
  void node;
  return (
    <div className="markdown-table-wrap">
      <table {...props}>{children}</table>
    </div>
  );
};

const markdownComponents = { table: MarkdownTable } satisfies Components;

export const AssistantMessage = memo(function AssistantMessage({
  message,
  variant = 'final',
}: AssistantMessageProps) {
  const t = useTranslations('workbench');
  const common = useTranslations('common');
  const [copied, setCopied] = useState(false);
  const isStreaming =
    message.status === 'running' || message.status === 'streaming' || !message.text;

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyMessage() {
    if (!message.text || !(await copyTextWithFallback(message.text))) return;
    setCopied(true);
  }

  if (variant === 'narrative')
    return (
      <div
        className="assistant-narrative"
        {...(isStreaming ? { role: 'status', 'aria-live': 'polite' as const } : {})}
      >
        {message.text ? (
          <div className="markdown-body">
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {message.text}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="message-streaming" aria-label={t('streamingNarrative')}>
            <LoaderCircle className="spin" size={14} aria-hidden="true" />
            <span>{t('streamingNarrative')}</span>
          </div>
        )}
      </div>
    );

  return (
    <article className="assistant-message">
      <div
        className="message-body markdown-body"
        {...(isStreaming ? { role: 'status', 'aria-live': 'polite' as const } : {})}
      >
        {message.text ? (
          <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
            {message.text}
          </ReactMarkdown>
        ) : (
          <div className="message-streaming" aria-label={t('streamingReply')}>
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>{t('streamingReply')}</span>
          </div>
        )}
        {message.text ? (
          <div className="assistant-message-actions">
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
});
