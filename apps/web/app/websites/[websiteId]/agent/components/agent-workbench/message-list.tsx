import { Sparkles } from 'lucide-react';
import { AssistantMessage } from './assistant-message';
import { useConversationScroll } from './conversation-scroll';
import { ExecutionProcess } from './tool-execution';
import { UserMessage } from './user-message';
import type { ConversationTurn } from './types';

type MessageListProps = {
  turns: ConversationTurn[];
  onExample: (value: string) => void;
};

const examples = ['修改首页标题和按钮', '调整页面配色', '优化导航栏布局'];

export function MessageList({ turns, onExample }: MessageListProps) {
  const contentVersion = JSON.stringify(turns);
  const latestUserMessageId = turns.at(-1)?.userMessage.id;
  const { containerRef, endRef, onScroll, returnToLatest, showReturnToLatest } =
    useConversationScroll(contentVersion, latestUserMessageId);

  return (
    <div ref={containerRef} className="message-viewport" onScroll={onScroll} aria-label="对话消息">
      <div className="message-list">
        {turns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">
              <Sparkles size={19} />
            </div>
            <h2>想先改什么？</h2>
            <p>描述你想修改的网站内容，我会在当前网站中完成修改。</p>
            <div className="example-prompts" aria-label="示例请求">
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
          aria-label="回到最新消息"
          title="回到最新消息"
        >
          回到最新消息
        </button>
      ) : null}
    </div>
  );
}

function ConversationTurnView({ turn }: { turn: ConversationTurn }) {
  return (
    <article className={`conversation-turn ${turn.status}`}>
      <UserMessage message={turn.userMessage} />
      {turn.execution?.length ? (
        <ExecutionProcess steps={turn.execution} status={turn.status} expanded={turn.expanded} />
      ) : null}
      {turn.error && !turn.execution?.length ? (
        <p className="turn-status-message" role="status">
          {turn.status === 'aborted' ? '已停止' : '执行失败'}：{turn.error}
        </p>
      ) : null}
      {turn.finalAnswer ? <AssistantMessage message={turn.finalAnswer} /> : null}
    </article>
  );
}
