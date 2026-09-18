'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  GitBranch,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Settings,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '../../../../../../i18n/navigation';
import { Brand } from '../../../../../../components/layout/brand';
import { LanguageSwitcher } from '../../../../../../components/layout/language-switcher';
import { ThemeSwitcher } from '../../../../../../components/theme-switcher';
import type { WorkspaceView } from '../unified-app';
import { authClient } from '@/lib/auth-client';

type Session = {
  id: string;
  websiteId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  pinnedAt: string | null;
  clonedFromSessionId: string | null;
};

type GroupedSessions = {
  websiteId: string;
  websiteName: string;
  status: string;
  previewUrl?: string;
  sessions: Session[];
};

type SessionDialogTarget = {
  websiteId: string;
  sessionId: string;
  title: string;
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
  onSessionRename: (websiteId: string, sessionId: string, title: string) => Promise<void>;
  onSessionPin: (websiteId: string, sessionId: string, pinned: boolean) => Promise<void>;
  onSessionClone: (websiteId: string, sessionId: string) => Promise<void>;
  onSessionDelete: (websiteId: string, sessionId: string) => Promise<void>;
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
  onSessionRename,
  onSessionPin,
  onSessionClone,
  onSessionDelete,
}: UnifiedSidebarProps) {
  const locale = useLocale();
  const { data: session } = authClient.useSession();
  const common = useTranslations('common');
  const t = useTranslations('navigation');
  const websiteT = useTranslations('websites');
  const workbenchT = useTranslations('workbench');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionDialogTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionDialogTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAvatarFailed(false);
  }, [session?.user.image]);

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
    if (!openMenuSessionId) return;
    function handlePointerDown(event: PointerEvent) {
      if (!sessionMenuRef.current?.contains(event.target as Node)) {
        setOpenMenuSessionId(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenuSessionId(null);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuSessionId]);

  useEffect(() => {
    if (!deleteTarget) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pendingAction) {
        setDeleteTarget(null);
        setDeleteError(null);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteTarget, pendingAction]);

  useEffect(() => {
    if (!renameTarget) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pendingAction) {
        setRenameTarget(null);
        setRenameValue('');
        setActionError(null);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [pendingAction, renameTarget]);

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
          {groupedSessions.length === 0 ? (
            <div className="unified-sidebar-websites-empty">{websiteT('noMoreWebsites')}</div>
          ) : null}
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
                      {visibleSessions.map((session) => {
                        const sessionTitle = session.title || workbenchT('newSessionTitle');
                        return (
                          <div
                            key={session.id}
                            className={`session-item ${selectedSession === session.id ? 'active' : ''}`}
                            ref={openMenuSessionId === session.id ? sessionMenuRef : undefined}
                            data-session-title={sessionTitle.length > 24 ? sessionTitle : undefined}
                          >
                            <button
                              type="button"
                              className="session-select-button"
                              onClick={() => onSessionSelect(group.websiteId, session.id)}
                            >
                              <span className="session-title">{sessionTitle}</span>
                              {session.clonedFromSessionId ? (
                                <GitBranch size={12} aria-label={workbenchT('clonedSession')} />
                              ) : null}
                            </button>
                            <div className="session-actions">
                              <button
                                type="button"
                                className={`session-pin-trigger${session.pinnedAt ? ' pinned' : ''}`}
                                onClick={async () => {
                                  if (pendingAction) return;
                                  setPendingAction(`pin:${session.id}`);
                                  setActionError(null);
                                  try {
                                    await onSessionPin(
                                      group.websiteId,
                                      session.id,
                                      !session.pinnedAt,
                                    );
                                  } catch (error) {
                                    setActionError(
                                      error instanceof Error
                                        ? error.message
                                        : workbenchT('sessionActionFailed'),
                                    );
                                  } finally {
                                    setPendingAction(null);
                                  }
                                }}
                                disabled={pendingAction !== null}
                                aria-label={
                                  session.pinnedAt
                                    ? workbenchT('unpinSession')
                                    : workbenchT('pinSession')
                                }
                                data-tooltip={
                                  session.pinnedAt
                                    ? workbenchT('unpinSession')
                                    : workbenchT('pinSession')
                                }
                              >
                                <Pin size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={`session-menu-trigger${session.pinnedAt ? ' pinned' : ''}`}
                                onClick={() => {
                                  setActionError(null);
                                  setOpenMenuSessionId((current) =>
                                    current === session.id ? null : session.id,
                                  );
                                }}
                                aria-label={`${workbenchT('sessionMenu')}: ${sessionTitle}`}
                                aria-expanded={openMenuSessionId === session.id}
                                aria-haspopup="menu"
                                data-tooltip={workbenchT('moreActions')}
                              >
                                <MoreHorizontal size={15} aria-hidden="true" />
                              </button>
                            </div>
                            {openMenuSessionId === session.id ? (
                              <div className="session-menu" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setActionError(null);
                                    setRenameValue(sessionTitle);
                                    setRenameTarget({
                                      websiteId: group.websiteId,
                                      sessionId: session.id,
                                      title: sessionTitle,
                                    });
                                    setOpenMenuSessionId(null);
                                  }}
                                >
                                  <Pencil size={14} aria-hidden="true" />{' '}
                                  {workbenchT('renameSession')}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={pendingAction !== null}
                                  onClick={async () => {
                                    setPendingAction(`pin:${session.id}`);
                                    setActionError(null);
                                    try {
                                      await onSessionPin(
                                        group.websiteId,
                                        session.id,
                                        !session.pinnedAt,
                                      );
                                      setOpenMenuSessionId(null);
                                    } catch (error) {
                                      setActionError(
                                        error instanceof Error
                                          ? error.message
                                          : workbenchT('sessionActionFailed'),
                                      );
                                    } finally {
                                      setPendingAction(null);
                                    }
                                  }}
                                >
                                  <Pin size={14} aria-hidden="true" />{' '}
                                  {session.pinnedAt
                                    ? workbenchT('unpinSession')
                                    : workbenchT('pinSession')}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={pendingAction !== null}
                                  onClick={async () => {
                                    setPendingAction(`clone:${session.id}`);
                                    setActionError(null);
                                    try {
                                      await onSessionClone(group.websiteId, session.id);
                                      setOpenMenuSessionId(null);
                                    } catch (error) {
                                      setActionError(
                                        error instanceof Error
                                          ? error.message
                                          : workbenchT('sessionActionFailed'),
                                      );
                                    } finally {
                                      setPendingAction(null);
                                    }
                                  }}
                                >
                                  <Copy size={14} aria-hidden="true" /> {workbenchT('cloneSession')}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="danger"
                                  disabled={pendingAction !== null}
                                  onClick={() => {
                                    setDeleteError(null);
                                    setDeleteTarget({
                                      websiteId: group.websiteId,
                                      sessionId: session.id,
                                      title: session.title || workbenchT('newSessionTitle'),
                                    });
                                    setOpenMenuSessionId(null);
                                  }}
                                >
                                  <Trash2 size={14} aria-hidden="true" />{' '}
                                  {workbenchT('deleteSession')}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
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
          {actionError ? (
            <div className="session-action-error" role="alert">
              {actionError}
            </div>
          ) : null}
        </div>
      </div>

      {deleteTarget ? (
        <div
          className="website-dialog-backdrop session-delete-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pendingAction) {
              setDeleteTarget(null);
              setDeleteError(null);
            }
          }}
        >
          <section
            className="website-dialog-panel session-delete-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-delete-title"
            aria-describedby="session-delete-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="session-delete-title">{workbenchT('deleteSessionTitle')}</h2>
            <p id="session-delete-description">
              {workbenchT('deleteSessionDescription', { title: deleteTarget.title })}
            </p>
            {deleteError ? (
              <p className="website-modal-error" role="alert">
                {deleteError}
              </p>
            ) : null}
            <div className="website-dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError(null);
                }}
                disabled={pendingAction !== null}
              >
                {common('cancel')}
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                onClick={async () => {
                  if (pendingAction) return;
                  setPendingAction(`delete:${deleteTarget.sessionId}`);
                  setDeleteError(null);
                  try {
                    await onSessionDelete(deleteTarget.websiteId, deleteTarget.sessionId);
                    setDeleteTarget(null);
                  } catch (error) {
                    setDeleteError(
                      error instanceof Error ? error.message : workbenchT('sessionActionFailed'),
                    );
                  } finally {
                    setPendingAction(null);
                  }
                }}
                disabled={pendingAction !== null}
              >
                {pendingAction ? workbenchT('deletingSession') : workbenchT('deleteSession')}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {renameTarget ? (
        <div
          className="website-dialog-backdrop session-rename-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pendingAction) {
              setRenameTarget(null);
              setRenameValue('');
            }
          }}
        >
          <section
            className="website-dialog-panel session-rename-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-rename-title"
            aria-describedby="session-rename-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="session-rename-title">{workbenchT('renameSessionTitle')}</h2>
            <p id="session-rename-description">{workbenchT('renameSessionDescription')}</p>
            <input
              autoFocus
              value={renameValue}
              maxLength={255}
              onChange={(event) => setRenameValue(event.target.value)}
              aria-label={workbenchT('renameSession')}
            />
            {actionError ? (
              <p className="website-modal-error" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="website-dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setRenameTarget(null);
                  setRenameValue('');
                  setActionError(null);
                }}
                disabled={pendingAction !== null}
              >
                {common('cancel')}
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={async () => {
                  const title = renameValue.trim();
                  if (!title || pendingAction) return;
                  setPendingAction(`rename:${renameTarget.sessionId}`);
                  setActionError(null);
                  try {
                    await onSessionRename(renameTarget.websiteId, renameTarget.sessionId, title);
                    setRenameTarget(null);
                    setRenameValue('');
                  } catch (error) {
                    setActionError(
                      error instanceof Error ? error.message : workbenchT('sessionActionFailed'),
                    );
                  } finally {
                    setPendingAction(null);
                  }
                }}
                disabled={pendingAction !== null || !renameValue.trim()}
              >
                {pendingAction ? workbenchT('savingSessionName') : workbenchT('saveSessionName')}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <div className="unified-sidebar-footer">
        <div className="unified-sidebar-account">
          {session?.user.image && !avatarFailed ? (
            <img
              className="unified-sidebar-account-avatar unified-sidebar-account-avatar-image"
              src={session.user.image}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span className="unified-sidebar-account-avatar" aria-hidden="true">
              <UserRound size={17} />
            </span>
          )}
          <span className="unified-sidebar-account-name">{session?.user.name ?? t('user')}</span>
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
            <div
              className="unified-sidebar-settings-popover"
              role="dialog"
              aria-label={t('settings')}
            >
              <div className="unified-sidebar-settings-row">
                <span>{t('language')}</span>
                <LanguageSwitcher />
              </div>
              <div className="unified-sidebar-settings-row">
                <span>{t('theme')}</span>
                <ThemeSwitcher />
              </div>
              <button
                type="button"
                className="unified-sidebar-settings-row"
                onClick={() =>
                  void authClient.signOut({
                    fetchOptions: { onSuccess: () => window.location.assign(`/${locale}/sign-in`) },
                  })
                }
              >
                <LogOut size={16} aria-hidden="true" />
                <span>退出登录</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
