import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AssistantMessage } from './assistant-message';
import { useConversationScroll } from './conversation-scroll';
import { ExecutionProcess } from './tool-execution';
import { UserMessage } from './user-message';
import type { ConversationTurn, ManualMaintenanceItem } from './types';

type MessageListProps = {
  turns: ConversationTurn[];
  onExample: (value: string) => void;
  manualMaintenanceItems?: ManualMaintenanceItem[];
  onInteractionRespond?: (
    interactionId: string,
    response: { type: 'option'; optionIndex: number } | { type: 'custom'; value: string },
  ) => void;
  onInteractionCancel?: (interactionId: string) => void;
  onReferenceUpload?: (interactionId: string, file: File) => Promise<void>;
};

export function MessageList({
  turns,
  onExample,
  manualMaintenanceItems = [],
  onInteractionRespond,
  onInteractionCancel,
  onReferenceUpload,
}: MessageListProps) {
  const t = useTranslations('workbench');
  const examples = [t('exampleTitle'), t('exampleColors'), t('exampleNavigation')];
  const contentVersion = JSON.stringify({ turns, manualMaintenanceItems });
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
          turns.map((turn) => (
            <div key={turn.userMessage.id} className="conversation-turn-slot">
              <ConversationTurnView
                turn={turn}
                onInteractionRespond={onInteractionRespond}
                onInteractionCancel={onInteractionCancel}
                onReferenceUpload={onReferenceUpload}
              />
              {manualMaintenanceItems
                .filter((item) => item.afterTurnId === turn.userMessage.id)
                .map((item) => (
                  <MaintenanceItem key={item.id} item={item} />
                ))}
            </div>
          ))
        )}
        {manualMaintenanceItems
          .filter(
            (item) =>
              !item.afterTurnId || !turns.some((turn) => turn.userMessage.id === item.afterTurnId),
          )
          .map((item) => (
            <MaintenanceItem key={item.id} item={item} />
          ))}
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

function MaintenanceItem({ item }: { item: ManualMaintenanceItem }) {
  const t = useTranslations('workbench');
  return (
    <div className={`context-maintenance ${item.status}`} role="status" aria-live="polite">
      <span aria-hidden="true">
        {item.status === 'running' ? '◌' : item.status === 'completed' ? '✓' : '!'}
      </span>
      <span>
        {item.status === 'running'
          ? t('compactionRunning')
          : item.status === 'completed'
            ? t('compactionCompleted')
            : t('compactionFailed')}
      </span>
    </div>
  );
}

function ConversationTurnView({
  turn,
  onInteractionRespond,
  onInteractionCancel,
  onReferenceUpload,
}: Pick<MessageListProps, 'onInteractionRespond' | 'onInteractionCancel' | 'onReferenceUpload'> & {
  turn: ConversationTurn;
}) {
  const t = useTranslations('workbench');
  return (
    <article className={`conversation-turn ${turn.status}`}>
      <UserMessage message={turn.userMessage} />
      {turn.execution?.length ? (
        <ExecutionProcess
          steps={turn.execution}
          status={turn.status}
          expanded={turn.expanded}
          onInteractionRespond={onInteractionRespond}
          onInteractionCancel={onInteractionCancel}
          onReferenceUpload={onReferenceUpload}
        />
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
