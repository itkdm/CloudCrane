import { Circle } from 'lucide-react';

type WorkbenchHeaderProps = {
  connection: string;
};

const connectionLabels: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中',
  reconnecting: '正在重连',
  unavailable: '连接失败',
};

export function WorkbenchHeader({ connection }: WorkbenchHeaderProps) {
  const isConnected = connection === 'connected';
  const connectionLabel = connectionLabels[connection] ?? '连接状态异常';

  return (
    <header className="workbench-header" aria-label="CloudCrane 工作台顶部导航">
      <div className="workbench-brand">
        <span className="brand-symbol" aria-hidden="true">
          鹤
        </span>
        <span className="brand-name">筑云鹤</span>
        <span className="brand-english">CloudCrane</span>
      </div>
      {!isConnected ? (
        <div
          className={`connection-status ${connection}`}
          role="status"
          aria-live="polite"
          aria-label={connectionLabel}
        >
          <Circle size={8} strokeWidth={0} fill="currentColor" aria-hidden="true" />
          {connectionLabel}
        </div>
      ) : null}
    </header>
  );
}
