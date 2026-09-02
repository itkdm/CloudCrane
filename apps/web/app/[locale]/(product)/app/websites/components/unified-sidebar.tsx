'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '../../../../../../i18n/navigation';
import { Brand } from '../../../../../../components/layout/brand';
import { LanguageSwitcher } from '../../../../../../components/layout/language-switcher';
import { ThemeSwitcher } from '../../../../../../components/theme-switcher';
import type { WorkspaceView } from '../unified-app';

type Session = {
  id: string;
  websiteId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

type GroupedSessions = {
  websiteId: string;
  websiteName: string;
  sessions: Session[];
};

type UnifiedSidebarProps = {
  view: WorkspaceView;
  groupedSessions: GroupedSessions[];
  selectedSession: string | null;
  onViewChange: (view: WorkspaceView) => void;
  onSessionSelect: (websiteId: string, sessionId: string) => void;
  onNewSession: (websiteId: string) => void;
};

export function UnifiedSidebar({
  view,
  groupedSessions,
  selectedSession,
  onViewChange,
  onSessionSelect,
  onNewSession,
}: UnifiedSidebarProps) {
  const t = useTranslations('navigation');
  const wt = useTranslations('workbench');
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`unified-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="unified-sidebar-header">
        <Link className="cc-brand" href="/">
          <Brand />
        </Link>
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? t('expand') : t('collapse')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
          </svg>
        </button>
      </div>

      <div className="unified-sidebar-content">
        <nav className="unified-sidebar-nav">
          <button
            className={`unified-sidebar-link ${view === 'websites' ? 'active' : ''}`}
            onClick={() => onViewChange('websites')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>{t('websites')}</span>
          </button>
          <button
            type="button"
            onClick={() => onViewChange('templates')}
            className={`unified-sidebar-link ${view === 'templates' ? 'active' : ''}`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>{t('templates')}</span>
          </button>
          <button
            className={`unified-sidebar-link ${view === 'conversations' ? 'active' : ''}`}
            onClick={() => onViewChange('conversations')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>{wt('sessions')}</span>
          </button>
        </nav>

        {view === 'conversations' && (
          <div className="unified-sidebar-sessions">
            {groupedSessions.map((group) => (
              <div key={group.websiteId} className="session-group">
                <div className="session-group-header">
                  <span className="session-group-title">{group.websiteName}</span>
                  <button
                    className="session-new-button"
                    onClick={() => onNewSession(group.websiteId)}
                    title={wt('newSession')}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
                {group.sessions.length === 0 ? (
                  <div className="session-empty">{wt('newSessionTitle')}</div>
                ) : (
                  <div className="session-list">
                    {group.sessions.map((session) => (
                      <button
                        key={session.id}
                        className={`session-item ${selectedSession === session.id ? 'active' : ''}`}
                        onClick={() => onSessionSelect(group.websiteId, session.id)}
                      >
                        <span className="session-title">
                          {session.title || wt('newSessionTitle')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="unified-sidebar-footer">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
    </aside>
  );
}
