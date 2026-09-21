import { memo, type ComponentProps } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
  const isStreaming =
    message.status === 'running' || message.status === 'streaming' || !message.text;

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
      </div>
    </article>
  );
});
