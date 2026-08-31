import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import type { Session } from './types';

type SessionSidebarProps = {
  sessions: Session[];
  sessionId?: string;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
};

type SessionGroup = { label: string; sessions: Session[] };

export function SessionSidebar({
  sessions,
  sessionId,
  onSelect,
  onCreate,
  collapsed = false,
  onToggle,
}: SessionSidebarProps) {
  const groups = groupSessions(sessions);

  return (
    <aside
      className={collapsed ? 'session-sidebar collapsed' : 'session-sidebar'}
      aria-label={collapsed ? '已折叠的对话列表' : '对话列表'}
    >
      <div className="sidebar-heading" id="session-sidebar-title">
        {!collapsed ? <span>对话</span> : null}
        {onToggle ? (
          <button
            className="icon-button sidebar-toggle-button"
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? '展开对话侧栏' : '折叠对话侧栏'}
            title={collapsed ? '展开对话侧栏' : '折叠对话侧栏'}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.8} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      <button
        className="new-session-button"
        type="button"
        onClick={onCreate}
        aria-label="新建对话"
        title="新建对话"
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        {!collapsed ? <span>新建对话</span> : null}
      </button>
      {!collapsed ? (
        <nav className="session-groups" aria-labelledby="session-sidebar-title">
          {groups.map((group) => (
            <section className="session-group" key={group.label}>
              <h2>{group.label}</h2>
              <div className="session-list">
                {group.sessions.map((session) => {
                  const isActive = session.id === sessionId;
                  const title = session.title?.trim() || '新对话';

                  return (
                    <button
                      className={isActive ? 'session-item active' : 'session-item'}
                      key={session.id}
                      type="button"
                      onClick={() => onSelect(session.id)}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={`打开对话：${title}`}
                      title={title}
                    >
                      <span className="session-title">{title}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      ) : null}
    </aside>
  );
}

function groupSessions(sessions: Session[]): SessionGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const groups: Record<string, Session[]> = { 今天: [], 昨天: [], 更早: [] };

  for (const session of sessions) {
    const created = new Date(session.updatedAt || session.createdAt);
    const day = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
    const label = day === today ? '今天' : day === yesterday ? '昨天' : '更早';
    groups[label]?.push(session);
  }

  return ['今天', '昨天', '更早']
    .map((label) => ({ label, sessions: groups[label] ?? [] }))
    .filter((group) => group.sessions.length > 0);
}
