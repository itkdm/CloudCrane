import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('workbench');
  const groups = groupSessions(sessions, t);

  return (
    <aside
      className={collapsed ? 'session-sidebar collapsed' : 'session-sidebar'}
      aria-label={collapsed ? t('collapsedSessions') : t('sessions')}
    >
      <div className="sidebar-heading" id="session-sidebar-title">
        {!collapsed ? <span>{t('sessions')}</span> : null}
        {onToggle ? (
          <button
            className="icon-button sidebar-toggle-button"
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? t('expandSessions') : t('collapseSessions')}
            title={collapsed ? t('expandSessions') : t('collapseSessions')}
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
        aria-label={t('newSession')}
        title={t('newSession')}
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        {!collapsed ? <span>{t('newSession')}</span> : null}
      </button>
      {!collapsed ? (
        <nav className="session-groups" aria-labelledby="session-sidebar-title">
          {groups.map((group) => (
            <section className="session-group" key={group.label}>
              <h2>{group.label}</h2>
              <div className="session-list">
                {group.sessions.map((session) => {
                  const isActive = session.id === sessionId;
                  const title = session.title?.trim() || t('newSessionTitle');

                  return (
                    <button
                      className={isActive ? 'session-item active' : 'session-item'}
                      key={session.id}
                      type="button"
                      onClick={() => onSelect(session.id)}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={t('openSession', { title })}
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

function groupSessions(sessions: Session[], t: (key: string) => string): SessionGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const labels = { today: t('today'), yesterday: t('yesterday'), earlier: t('earlier') };
  const groups: Record<string, Session[]> = {
    [labels.today]: [],
    [labels.yesterday]: [],
    [labels.earlier]: [],
  };

  for (const session of sessions) {
    const created = new Date(session.updatedAt || session.createdAt);
    const day = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
    const label =
      day === today ? labels.today : day === yesterday ? labels.yesterday : labels.earlier;
    groups[label]?.push(session);
  }

  return [labels.today, labels.yesterday, labels.earlier]
    .map((label) => ({ label, sessions: groups[label] ?? [] }))
    .filter((group) => group.sessions.length > 0);
}
