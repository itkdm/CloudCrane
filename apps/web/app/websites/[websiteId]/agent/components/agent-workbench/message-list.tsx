import { Sparkles } from 'lucide-react';
import { AssistantMessage } from './assistant-message';
import { ToolExecution } from './tool-execution';
import { UserMessage } from './user-message';
import type { Message } from './types';

type MessageListProps = {
  messages: Message[];
  onExample: (value: string) => void;
};

const examples = ['修改首页标题和按钮', '调整页面配色', '优化导航栏布局'];

export function MessageList({ messages, onExample }: MessageListProps) {
  return (
    <div className="message-list" aria-live="polite">
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">
            <Sparkles size={19} />
          </div>
          <h2>想先改什么？</h2>
          <p>
            告诉我希望修改的网站内容，
            <br />
            我会直接在当前网站中完成修改并检查结果。
          </p>
          <div className="example-prompts" aria-label="示例请求">
            {examples.map((example) => (
              <button type="button" key={example} onClick={() => onExample(example)}>
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : (
        messages
          .filter((message) => message.role !== 'tool' || Boolean(message.toolName))
          .map((message) => {
            if (message.role === 'assistant')
              return <AssistantMessage key={message.id} message={message} />;
            if (message.role === 'tool')
              return <ToolExecution key={message.id} message={message} />;
            return <UserMessage key={message.id} message={message} />;
          })
      )}
    </div>
  );
}
