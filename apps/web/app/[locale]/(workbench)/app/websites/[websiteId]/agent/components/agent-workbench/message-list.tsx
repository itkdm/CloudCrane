import { LoaderCircle, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef } from 'react';
import { AssistantMessage } from './assistant-message';
import { useConversationScroll } from './conversation-scroll';
import { ExecutionProcess } from './tool-execution';
import { UserMessage } from './user-message';
import type { ConversationTurn, ManualMaintenanceItem } from './types';

type MessageListProps = {
  turns: ConversationTurn[];
  pendingPrompt?: string;
  sessionLoading?: boolean;
  conversationRevision?: number;
  hasOlderHistory?: boolean;
  loadingOlderHistory?: boolean;
  onLoadOlderHistory?: () => void;
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
  pendingPrompt,
  sessionLoading = false,
  conversationRevision = 0,
  hasOlderHistory = false,
  loadingOlderHistory = false,
  onExample,
  onLoadOlderHistory,
  manualMaintenanceItems = [],
  onInteractionRespond,
  onInteractionCancel,
  onReferenceUpload,
}: MessageListProps) {
  const t = useTranslations('workbench');
  const examples = [t('exampleTitle'), t('exampleColors'), t('exampleNavigation')];
  const prependAnchorRef = useRef<
    { scrollHeight: number; scrollTop: number; turnCount: number } | undefined
  >(undefined);
  const contentVersion = conversationRevision;
  const latestUserMessageId =
    turns.at(-1)?.userMessage.id ?? (pendingPrompt ? 'pending-initial-prompt' : undefined);
  const { containerRef, onScroll, onWheel, onTouchStart, onTouchMove, onTouchEnd } =
    useConversationScroll(contentVersion, latestUserMessageId);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const container = containerRef.current;
    if (!anchor || !container) return;
    if (turns.length > anchor.turnCount) {
      container.scrollTop = anchor.scrollTop + container.scrollHeight - anchor.scrollHeight;
      prependAnchorRef.current = undefined;
    } else if (!loadingOlderHistory) {
      prependAnchorRef.current = undefined;
    }
  }, [containerRef, loadingOlderHistory, turns.length]);

  const loadOlderHistory = () => {
    const container = containerRef.current;
    if (!container || !onLoadOlderHistory || loadingOlderHistory) return;
    prependAnchorRef.current = {
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      turnCount: turns.length,
    };
    onLoadOlderHistory();
  };

  return (
    <div className="message-list-shell">
      <div
        ref={containerRef}
        className="message-viewport"
        onScroll={onScroll}
        onWheel={(event) => onWheel(event.deltaY)}
        onTouchStart={(event) => onTouchStart(event.touches[0]?.clientY ?? 0)}
        onTouchMove={(event) => onTouchMove(event.touches[0]?.clientY ?? 0)}
        onTouchEnd={onTouchEnd}
        aria-label={t('chat')}
      >
        <div className="message-list">
          {hasOlderHistory ? (
            <button
              className="load-older-history"
              type="button"
              onClick={loadOlderHistory}
              disabled={loadingOlderHistory}
            >
              {loadingOlderHistory ? t('loadingOlderConversation') : t('loadOlderConversation')}
            </button>
          ) : null}
          {turns.length === 0 && pendingPrompt ? (
            <div className="conversation-turn pending-initial-turn">
              <UserMessage
                message={{
                  id: 'pending-initial-prompt',
                  role: 'user',
                  text: pendingPrompt,
                  status: 'pending',
                }}
              />
              <AssistantMessage
                message={{
                  id: 'pending-initial-response',
                  role: 'assistant',
                  text: '',
                  status: 'streaming',
                }}
              />
            </div>
          ) : turns.length === 0 && sessionLoading ? (
            <div className="session-loading" role="status" aria-live="polite">
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
              <span>{t('loadingConversation')}</span>
            </div>
          ) : turns.length === 0 ? (
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
                !item.afterTurnId ||
                !turns.some((turn) => turn.userMessage.id === item.afterTurnId),
            )
            .map((item) => (
              <MaintenanceItem key={item.id} item={item} />
            ))}
        </div>
      </div>
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
  const hasActiveExecutionStep = Boolean(
    turn.execution?.some((step) =>
      step.kind === 'assistant'
        ? step.status === 'streaming'
        : step.kind === 'tool'
          ? step.status === 'running'
          : step.status === 'running',
    ),
  );
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
          {turn.status === 'aborted'
            ? t('aborted')
            : turn.status === 'interrupted'
              ? t('interrupted')
              : t('failed')}
          ：{friendlyTurnError(turn.error, t)}
        </p>
      ) : null}
      {turn.finalAnswer ? (
        <AssistantMessage message={turn.finalAnswer} />
      ) : turn.status === 'running' && !hasActiveExecutionStep ? (
        <AssistantMessage
          message={{
            id: `${turn.userMessage.id}-pending-assistant`,
            role: 'assistant',
            text: '',
            status: 'streaming',
          }}
        />
      ) : null}
    </article>
  );
}

function friendlyTurnError(error: string, t: (key: string) => string): string {
  if (/configured model does not support image attachments/i.test(error))
    return t('imageAttachmentsUnsupported');
  return error;
}
