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
  return (
    <header className="workbench-header">
      <div className="workbench-brand">
        <span className="brand-symbol" aria-hidden="true">
          鹤
        </span>
        <span className="brand-name">筑云鹤</span>
        <span className="brand-english">CloudCrane</span>
      </div>
      <div className="website-context">
        <span className="context-label">当前网站</span>
        <span className="context-name">CloudCrane Website</span>
      </div>
      <div className={`connection-status ${connection}`} aria-live="polite">
        <Circle size={8} strokeWidth={0} fill="currentColor" aria-hidden="true" />
        {connectionLabels[connection] ?? '连接中'}
      </div>
    </header>
  );
}
