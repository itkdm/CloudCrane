import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AssistantMessage } from './assistant-message';
import { useConversationScroll } from './conversation-scroll';
import { ExecutionProcess } from './tool-execution';
import { UserMessage } from './user-message';
import type { ConversationTurn } from './types';

type MessageListProps = {
  turns: ConversationTurn[];
  onExample: (value: string) => void;
};

export function MessageList({ turns, onExample }: MessageListProps) {
  const t = useTranslations('workbench');
  const examples = [t('exampleTitle'), t('exampleColors'), t('exampleNavigation')];
  const contentVersion = JSON.stringify(turns);
  const latestUserMessageId = turns.at(-1)?.userMessage.id;
  const { containerRef, endRef, onScroll, returnToLatest, showReturnToLatest } =
    useConversationScroll(contentVersion, latestUserMessageId);

  return (
    <div ref={containerRef} className="message-viewport" onScroll={onScroll} aria-label={t('chat')}>
      <div className="message-list">
        {turns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">
              <Sparkles size={19} />
            </div>
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyDescription')}</p>
            <div className="example-prompts" aria-label={t('examples')}>
              {examples.map((example) => (
                <button type="button" key={example} onClick={() => onExample(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => <ConversationTurnView key={turn.userMessage.id} turn={turn} />)
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>
      {showReturnToLatest ? (
        <button
          className="return-to-latest"
          type="button"
          onClick={returnToLatest}
          aria-label={t('latest')}
          title={t('latest')}
        >
          {t('latest')}
        </button>
      ) : null}
    </div>
  );
}

function ConversationTurnView({ turn }: { turn: ConversationTurn }) {
  const t = useTranslations('workbench');
  return (
    <article className={`conversation-turn ${turn.status}`}>
      <UserMessage message={turn.userMessage} />
      {turn.execution?.length ? (
        <ExecutionProcess steps={turn.execution} status={turn.status} expanded={turn.expanded} />
      ) : null}
      {turn.error && !turn.execution?.length ? (
        <p className="turn-status-message" role="status">
          {turn.status === 'aborted' ? t('aborted') : t('failed')}：{turn.error}
        </p>
      ) : null}
      {turn.finalAnswer ? <AssistantMessage message={turn.finalAnswer} /> : null}
    </article>
  );
}
