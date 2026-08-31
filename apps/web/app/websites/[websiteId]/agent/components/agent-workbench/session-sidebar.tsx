import { Plus } from 'lucide-react';
import type { Session } from './types';

type SessionSidebarProps = {
  sessions: Session[];
  sessionId?: string;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
};

type SessionGroup = { label: string; sessions: Session[] };

export function SessionSidebar({ sessions, sessionId, onSelect, onCreate }: SessionSidebarProps) {
  const groups = groupSessions(sessions);

  return (
    <aside className="session-sidebar" aria-label="对话列表">
      <div className="sidebar-heading">
        <span>对话</span>
      </div>
      <button className="new-session-button" type="button" onClick={onCreate}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        <span>新建对话</span>
      </button>
      <nav className="session-groups">
        {groups.map((group) => (
          <section className="session-group" key={group.label}>
            <h2>{group.label}</h2>
            <div className="session-list">
              {group.sessions.map((session) => (
                <button
                  className={session.id === sessionId ? 'session-item active' : 'session-item'}
                  key={session.id}
                  type="button"
                  onClick={() => onSelect(session.id)}
                >
                  <span className="session-title">{session.title || '新对话'}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </nav>
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
