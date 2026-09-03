'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, PanelLeftClose, PanelLeftOpen, Settings, UserRound } from 'lucide-react';
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
  status: string;
  previewUrl?: string;
  sessions: Session[];
};

type UnifiedSidebarProps = {
  view: WorkspaceView;
  collapsed: boolean;
  groupedSessions: GroupedSessions[];
  selectedSession: string | null;
  onCollapsedChange: (collapsed: boolean) => void;
  onViewChange: (view: WorkspaceView) => void;
  onSessionSelect: (websiteId: string, sessionId: string) => void;
  onNewSession: (websiteId: string) => void;
  onCreateWebsite: () => void;
  onSettingsOpen: (websiteId: string) => void;
};

export function UnifiedSidebar({
  view,
  collapsed,
  groupedSessions,
  selectedSession,
  onCollapsedChange,
  onViewChange,
  onSessionSelect,
  onNewSession,
  onCreateWebsite,
  onSettingsOpen,
}: UnifiedSidebarProps) {
  const t = useTranslations('navigation');
  const websiteT = useTranslations('websites');
  const workbenchT = useTranslations('workbench');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSettingsOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    setExpandedGroups((current) => {
      let next: Record<string, boolean> | undefined;
      for (const group of groupedSessions) {
        if (!(group.websiteId in current)) {
          next ??= { ...current };
          next[group.websiteId] = true;
        }
      }
      return next ?? current;
    });
  }, [groupedSessions]);

  useEffect(() => {
    const selectedGroup = groupedSessions.find((group) =>
      group.sessions.some((session) => session.id === selectedSession),
    );
    if (!selectedGroup) return;
    setExpandedGroups((current) =>
      current[selectedGroup.websiteId] === true
        ? current
        : { ...current, [selectedGroup.websiteId]: true },
    );
  }, [groupedSessions, selectedSession]);

  function toggleGroup(websiteId: string) {
    setExpandedGroups((current) => ({ ...current, [websiteId]: !current[websiteId] }));
  }

  function toggleSessionList(websiteId: string) {
    setExpandedSessionLists((current) => ({ ...current, [websiteId]: !current[websiteId] }));
  }

  return (
    <aside className={`unified-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="unified-sidebar-header">
        <Link className="cc-brand" href="/">
          <Brand />
        </Link>
        <button
          className="sidebar-toggle"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? t('expand') : t('collapse')}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={17} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="unified-sidebar-content">
        <nav className="unified-sidebar-nav">
          <button
            type="button"
            className="unified-sidebar-link"
            onClick={onCreateWebsite}
            title={websiteT('create')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>{websiteT('create')}</span>
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
        </nav>

        <div className="unified-sidebar-sessions">
          <div className="unified-sidebar-section-label">{websiteT('title')}</div>
          {groupedSessions.map((group) => {
            const expanded = expandedGroups[group.websiteId] ?? true;
            const sessionsExpanded = expandedSessionLists[group.websiteId] ?? false;
            const visibleSessions = sessionsExpanded
              ? group.sessions
              : group.sessions.filter(
                  (session, index) => index < 5 || session.id === selectedSession,
                );
            const hasMoreSessions = visibleSessions.length < group.sessions.length;
            return (
              <div key={group.websiteId} className="session-group">
                <div className="session-group-header">
                  <button
                    type="button"
                    className="session-group-toggle"
                    onClick={() => toggleGroup(group.websiteId)}
                    aria-expanded={expanded}
                    title={group.websiteName}
                  >
                    <svg
                      className="session-group-folder"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-15z" />
                      <path d="M3.5 6.5v-1a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span className="session-group-title">{group.websiteName}</span>
                  </button>
                  <button
                    type="button"
                    className="session-settings-button"
                    onClick={() => onSettingsOpen(group.websiteId)}
                    title={websiteT('settings')}
                    aria-label={`${websiteT('settings')}: ${group.websiteName}`}
                  >
                    <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="session-new-button"
                    onClick={() => onNewSession(group.websiteId)}
                    title={workbenchT('newSession')}
                    aria-label={`${workbenchT('newSession')}: ${group.websiteName}`}
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
                {expanded ? (
                  group.sessions.length === 0 ? (
                    <div className="session-empty">{workbenchT('noSessions')}</div>
                  ) : (
                    <div className="session-list">
                      {visibleSessions.map((session) => (
                        <button
                          key={session.id}
                          className={`session-item ${selectedSession === session.id ? 'active' : ''}`}
                          onClick={() => onSessionSelect(group.websiteId, session.id)}
                        >
                          <span className="session-title">
                            {session.title || workbenchT('newSessionTitle')}
                          </span>
                        </button>
                      ))}
                      {group.sessions.length > 5 ? (
                        <button
                          type="button"
                          className="session-list-toggle"
                          onClick={() => toggleSessionList(group.websiteId)}
                        >
                          {hasMoreSessions
                            ? workbenchT('showMoreSessions')
                            : workbenchT('showFewerSessions')}
                        </button>
                      ) : null}
                    </div>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="unified-sidebar-footer">
        <div className="unified-sidebar-account">
          <span className="unified-sidebar-account-avatar" aria-hidden="true">
            <UserRound size={17} />
          </span>
          <span className="unified-sidebar-account-name">{t('user')}</span>
        </div>
        <div className="unified-sidebar-settings-anchor" ref={settingsRef}>
          <button
            type="button"
            className="unified-sidebar-settings"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label={t('settings')}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            title={t('settings')}
          >
            <Settings size={18} aria-hidden="true" />
          </button>
          {settingsOpen ? (
            <div className="unified-sidebar-settings-popover" role="dialog" aria-label={t('settings')}>
              <div className="unified-sidebar-settings-row">
                <span>{t('language')}</span>
                <LanguageSwitcher />
              </div>
              <div className="unified-sidebar-settings-row">
                <span>{t('theme')}</span>
                <ThemeSwitcher />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
