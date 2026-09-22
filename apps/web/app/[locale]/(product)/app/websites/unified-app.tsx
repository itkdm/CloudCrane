'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  cloneAgentSession,
  createAgentSession,
  deleteAgentSession,
  listAgentSessions,
  updateAgentSession,
  type AgentSession,
} from '@/lib/agent-client';
import { UnifiedSidebar } from './components/unified-sidebar';
import { AgentWorkbenchContent } from './components/agent-workbench-content';
import { TemplatesView, type TemplateSummary } from './components/templates-view';
import { WebsiteCreateDialog, type CreatedWebsite } from './components/website-create-dialog';
import { WebsiteSettingsDialog } from './components/website-settings-dialog';
import { WorkspaceStart } from './components/workspace-start';
import './websites.css';
import { compareSessionsByActivity } from '@/lib/session-sorting';
import { buildWorkspacePath } from '@/lib/workspace-route';
import { canEnterWorkspace } from '@/lib/website-session-loading';

export type WorkspaceView = 'websites' | 'templates';

export type WorkspaceInitialState = {
  view?: WorkspaceView;
  websiteId?: string | null;
  sessionId?: string | null;
};

type Website = CreatedWebsite;

type Session = {
  id: string;
  websiteId: string;
  title?: string;
  pinnedAt: string | null;
  clonedFromSessionId: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SessionChange =
  | string
  | {
      id: string;
      title?: string | null;
      createdAt?: string;
      updatedAt?: string;
      lastActiveAt?: string | null;
      pinnedAt?: string | null;
      clonedFromSessionId?: string | null;
    };

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'cloudcrane.sidebar.collapsed';

function readSidebarCollapsedPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSidebarCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

type GroupedSessions = {
  websiteId: string;
  websiteName: string;
  status: string;
  previewUrl?: string;
  sessions: Session[];
};

export function UnifiedApp({ initialState }: { initialState?: WorkspaceInitialState }) {
  const t = useTranslations('websites');
  const [view, setView] = useState<WorkspaceView>(initialState?.view ?? 'websites');
  const [selectedWebsite, setSelectedWebsite] = useState<string | null>(
    initialState?.websiteId ?? null,
  );
  const [selectedSession, setSelectedSession] = useState<string | null>(
    initialState?.sessionId ?? null,
  );
  const [websites, setWebsites] = useState<Website[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const loadRequestRef = useRef(0);
  const deletedSessionIdsRef = useRef(new Set<string>());
  const [createWebsiteOpen, setCreateWebsiteOpen] = useState(false);
  const [selectedTemplateForCreate, setSelectedTemplateForCreate] =
    useState<TemplateSummary | null>(null);
  const [settingsWebsiteId, setSettingsWebsiteId] = useState<string | null>(null);
  const [deletingWebsiteId, setDeletingWebsiteId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const previewOpenRef = useRef(false);
  const sidebarBeforePreviewRef = useRef<boolean | null>(null);
  const sidebarAutoCollapsedRef = useRef(false);
  const sidebarChangedDuringPreviewRef = useRef(false);
  const [pendingFirstSessionWebsiteId, setPendingFirstSessionWebsiteId] = useState<string | null>(
    null,
  );
  const [websiteLoadState, setWebsiteLoadState] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [websiteLoadError, setWebsiteLoadError] = useState('');
  const [startPrompt, setStartPrompt] = useState('');
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [startError, setStartError] = useState('');
  const [pendingStartPrompt, setPendingStartPrompt] = useState<{
    id: string;
    websiteId: string;
    text: string;
  } | null>(null);

  useLayoutEffect(() => {
    const storedPreference = readSidebarCollapsedPreference();
    setSidebarCollapsed((current) => (current === storedPreference ? current : storedPreference));
  }, []);

  const loadWebsites = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    deletedSessionIdsRef.current.clear();
    setWebsiteLoadState('loading');
    setWebsiteLoadError('');
    try {
      const websitesRes = await fetch('/api/websites');
      if (!websitesRes.ok) throw new Error(t('loadError'));
      const websitesData = (await websitesRes.json()) as Website[];
      if (requestId !== loadRequestRef.current) return;
      setWebsites(websitesData);
      setSessions([]);
      setWebsiteLoadState('success');

      const sessionResults = await Promise.allSettled(
        websitesData.filter(canEnterWorkspace).map(async (website) => {
          const result = await listAgentSessions(website.id);
          return result.sessions.map((session) => ({
            ...session,
            websiteId: website.id,
            title: session.title ?? undefined,
            pinnedAt: session.pinnedAt,
            clonedFromSessionId: session.clonedFromSessionId,
            lastActiveAt: session.lastActiveAt,
          }));
        }),
      );
      if (requestId !== loadRequestRef.current) return;
      const loadedSessions = sessionResults.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );
      setSessions((current) => {
        const deletedSessionIds = deletedSessionIdsRef.current;
        const visibleLoadedSessions = loadedSessions.filter(
          (session) => !deletedSessionIds.has(session.id),
        );
        const currentById = new Map(current.map((session) => [session.id, session]));
        const loadedIds = new Set(visibleLoadedSessions.map((session) => session.id));
        const merged = visibleLoadedSessions.map((session) => ({
          ...session,
          ...currentById.get(session.id),
        }));
        return [
          ...merged,
          ...current.filter(
            (session) => !loadedIds.has(session.id) && !deletedSessionIds.has(session.id),
          ),
        ];
      });
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setWebsites([]);
      setSessions([]);
      setWebsiteLoadError(error instanceof Error ? error.message : t('loadError'));
      setWebsiteLoadState('error');
    }
  }, [t]);

  useEffect(() => {
    void loadWebsites();
  }, [loadWebsites]);

  useEffect(() => {
    const locale = window.location.pathname.split('/').filter(Boolean)[0] ?? 'zh';
    const nextUrl = buildWorkspacePath(locale, {
      view,
      websiteId: selectedWebsite,
      sessionId: selectedSession,
    });
    window.history.replaceState(null, '', nextUrl);
  }, [view, selectedWebsite, selectedSession]);

  useEffect(() => {
    if (websiteLoadState !== 'success' || !selectedWebsite) return;
    const website = websites.find((item) => item.id === selectedWebsite);
    if (!website) {
      setSelectedWebsite(null);
      setSelectedSession(null);
      return;
    }
    if (!canEnterWorkspace(website)) {
      setSelectedSession(null);
      setSettingsWebsiteId(selectedWebsite);
    }
  }, [selectedWebsite, websiteLoadState, websites]);

  const groupedSessions = useMemo<GroupedSessions[]>(
    () =>
      websites.map((website) => ({
        websiteId: website.id,
        websiteName: website.name,
        status: website.status,
        previewUrl: website.previewUrl,
        sessions: sessions
          .filter((s) => s.websiteId === website.id)
          .sort(compareSessionsByActivity),
      })),
    [sessions, websites],
  );

  function mergeSession(websiteId: string, next: AgentSession): void {
    setSessions((current) => {
      const mapped: Session = {
        id: next.id,
        websiteId,
        title: next.title ?? undefined,
        pinnedAt: next.pinnedAt,
        clonedFromSessionId: next.clonedFromSessionId,
        lastActiveAt: next.lastActiveAt,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
      };
      return current.some((item) => item.id === next.id)
        ? current.map((item) => (item.id === next.id ? { ...item, ...mapped } : item))
        : [...current, mapped];
    });
  }

  const handleRenameSession = useCallback(
    async (websiteId: string, sessionId: string, title: string) => {
      const result = await updateAgentSession(websiteId, sessionId, { title });
      mergeSession(websiteId, result.session);
    },
    [],
  );

  const handlePinSession = useCallback(
    async (websiteId: string, sessionId: string, pinned: boolean) => {
      const result = await updateAgentSession(websiteId, sessionId, { pinned });
      mergeSession(websiteId, result.session);
    },
    [],
  );

  const handleCloneSession = useCallback(async (websiteId: string, sessionId: string) => {
    const result = await cloneAgentSession(websiteId, sessionId);
    mergeSession(websiteId, result.session);
    setSelectedWebsite(websiteId);
    setSelectedSession(result.session.id);
    setView('websites');
  }, []);

  const handleDeleteSession = useCallback(
    async (websiteId: string, sessionId: string) => {
      await deleteAgentSession(websiteId, sessionId);
      deletedSessionIdsRef.current.add(sessionId);
      setSessions((current) => current.filter((item) => item.id !== sessionId));
      if (selectedSession !== sessionId) return;
      const next = sessions
        .filter((item) => item.websiteId === websiteId && item.id !== sessionId)
        .sort(compareSessionsByActivity)[0];
      setSelectedWebsite(websiteId);
      setSelectedSession(next?.id ?? null);
    },
    [selectedSession, sessions],
  );

  function handleViewChange(nextView: WorkspaceView) {
    setView(nextView);
  }

  function handleSessionSelect(websiteId: string, sessionId: string) {
    const website = websites.find((item) => item.id === websiteId);
    if (!canEnterWorkspace(website)) {
      handleAuthorizeWebsite(websiteId);
      return;
    }
    setSelectedWebsite(websiteId);
    setSelectedSession(sessionId);
    setView('websites');
  }

  function handleNewSession(websiteId: string) {
    const website = websites.find((item) => item.id === websiteId);
    if (!canEnterWorkspace(website)) {
      handleAuthorizeWebsite(websiteId);
      return;
    }
    setSelectedWebsite(websiteId);
    setSelectedSession(null);
    setView('websites');
    setStartError('');
  }

  function handleWebsiteCreated(website: Website) {
    setWebsites((current) => [...current, website]);
    setCreateWebsiteOpen(false);
    setSelectedSession(null);
    setView('websites');
    if (website.status === 'authorization_required') {
      setSelectedWebsite(null);
      setSettingsWebsiteId(website.id);
      setPendingFirstSessionWebsiteId(website.id);
      return;
    }
    if (website.status === 'ready') {
      setSelectedWebsite(website.id);
      setStartError('');
      return;
    }
    setSelectedWebsite(null);
  }

  function handleAuthorizeWebsite(websiteId: string) {
    setSettingsWebsiteId(websiteId);
  }

  async function handleDeleteWebsite() {
    if (!settingsWebsiteId) return;
    const websiteId = settingsWebsiteId;
    let response: Response;
    try {
      response = await fetch(`/api/websites/${websiteId}`, { method: 'DELETE' });
    } catch (error) {
      setDeletingWebsiteId(null);
      throw error;
    }
    if (!response.ok) {
      let message = t('operationIncomplete');
      try {
        const payload = (await response.json()) as { error?: { code?: string; message?: string } };
        message =
          payload.error?.code === 'WEBSITE_NOT_FOUND' ? t('websiteNotFound') : t('deleteError');
      } catch {
        // Keep the generic message when the server did not return JSON.
      }
      setDeletingWebsiteId(null);
      throw new Error(message);
    }
    const remainingWebsites = websites.filter((website) => website.id !== websiteId);
    deletedSessionIdsRef.current = new Set([
      ...deletedSessionIdsRef.current,
      ...sessions.filter((session) => session.websiteId === websiteId).map((session) => session.id),
    ]);
    setWebsites(remainingWebsites);
    setSessions((current) => current.filter((session) => session.websiteId !== websiteId));
    setSettingsWebsiteId(null);
    setDeletingWebsiteId(null);
    setPendingFirstSessionWebsiteId((current) => (current === websiteId ? null : current));
    setPendingStartPrompt((current) => (current?.websiteId === websiteId ? null : current));
    setStartError('');
    if (selectedWebsite === websiteId) {
      const nextWebsite = remainingWebsites.find(canEnterWorkspace);
      setSelectedWebsite(nextWebsite?.id ?? null);
      setSelectedSession(null);
    }
  }

  function handleAuthorizationComplete() {
    if (!settingsWebsiteId) return;
    const websiteId = settingsWebsiteId;
    const isFirstSessionPending = pendingFirstSessionWebsiteId === websiteId;
    setWebsites((current) =>
      current.map((website) =>
        website.id === websiteId ? { ...website, status: 'ready' } : website,
      ),
    );
    if (isFirstSessionPending) {
      setPendingFirstSessionWebsiteId(null);
      setSettingsWebsiteId(null);
      setSelectedWebsite(websiteId);
      setSelectedSession(null);
      setView('websites');
    }
  }

  const handleStartPrompt = useCallback(async () => {
    const website = selectedWebsite
      ? websites.find((item) => item.id === selectedWebsite)
      : undefined;
    const text = startPrompt.trim();
    if (!text || !canEnterWorkspace(website) || startSubmitting) return;

    setStartSubmitting(true);
    setStartError('');
    try {
      const created = await createAgentSession(website.id);
      const promptId = crypto.randomUUID();
      setSessions((current) => [
        ...current,
        {
          id: created.session.id,
          websiteId: website.id,
          title: created.session.title ?? undefined,
          createdAt: created.session.createdAt,
          updatedAt: created.session.updatedAt,
          pinnedAt: created.session.pinnedAt,
          clonedFromSessionId: created.session.clonedFromSessionId,
          lastActiveAt: created.session.lastActiveAt,
        },
      ]);
      setPendingStartPrompt({ id: promptId, websiteId: website.id, text });
      setSelectedWebsite(website.id);
      setSelectedSession(created.session.id);
      setView('websites');
      setStartPrompt('');
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : t('operationIncomplete'));
    } finally {
      setStartSubmitting(false);
    }
  }, [selectedWebsite, startPrompt, startSubmitting, t, websites]);

  const handleInitialPromptConsumed = useCallback((promptId: string) => {
    setPendingStartPrompt((current) => (current?.id === promptId ? null : current));
  }, []);

  const settingsWebsite = websites.find((website) => website.id === settingsWebsiteId) ?? null;
  const selectedWebsiteRecord = selectedWebsite
    ? websites.find((website) => website.id === selectedWebsite)
    : undefined;
  const canRenderSelectedWorkbench = Boolean(
    selectedWebsite &&
    selectedSession &&
    deletingWebsiteId !== selectedWebsite &&
    (websiteLoadState === 'loading' ||
      (websiteLoadState === 'success' && canEnterWorkspace(selectedWebsiteRecord))),
  );

  const handleSessionChange = useCallback(
    (change: SessionChange) => {
      const metadata = typeof change === 'string' ? { id: change } : change;
      setSelectedSession(metadata.id);
      setSessions((current) =>
        current.some((s) => s.id === metadata.id)
          ? current.map((session) =>
              session.id === metadata.id
                ? {
                    ...session,
                    ...(metadata.title !== undefined ? { title: metadata.title ?? undefined } : {}),
                    ...(metadata.createdAt ? { createdAt: metadata.createdAt } : {}),
                    ...(metadata.updatedAt ? { updatedAt: metadata.updatedAt } : {}),
                    ...(metadata.lastActiveAt !== undefined
                      ? { lastActiveAt: metadata.lastActiveAt }
                      : {}),
                    ...(metadata.pinnedAt !== undefined ? { pinnedAt: metadata.pinnedAt } : {}),
                    ...(metadata.clonedFromSessionId !== undefined
                      ? { clonedFromSessionId: metadata.clonedFromSessionId }
                      : {}),
                  }
                : session,
            )
          : [
              ...current,
              {
                id: metadata.id,
                websiteId: selectedWebsite ?? '',
                title: metadata.title ?? '',
                createdAt: metadata.createdAt ?? new Date().toISOString(),
                updatedAt: metadata.updatedAt ?? new Date().toISOString(),
                pinnedAt: metadata.pinnedAt ?? null,
                clonedFromSessionId: metadata.clonedFromSessionId ?? null,
                lastActiveAt: metadata.lastActiveAt ?? null,
              },
            ],
      );
    },
    [selectedWebsite],
  );

  const handleSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    if (previewOpenRef.current) sidebarChangedDuringPreviewRef.current = true;
    setSidebarCollapsed(collapsed);
    writeSidebarCollapsedPreference(collapsed);
  }, []);

  const handlePreviewOpenChange = useCallback(
    (open: boolean) => {
      if (open === previewOpenRef.current) return;
      previewOpenRef.current = open;

      if (open) {
        sidebarBeforePreviewRef.current = sidebarCollapsed;
        sidebarAutoCollapsedRef.current = !sidebarCollapsed;
        sidebarChangedDuringPreviewRef.current = false;
        if (!sidebarCollapsed) setSidebarCollapsed(true);
        return;
      }

      if (
        sidebarAutoCollapsedRef.current &&
        !sidebarChangedDuringPreviewRef.current &&
        sidebarBeforePreviewRef.current !== null
      ) {
        setSidebarCollapsed(sidebarBeforePreviewRef.current);
      }
      sidebarBeforePreviewRef.current = null;
      sidebarAutoCollapsedRef.current = false;
      sidebarChangedDuringPreviewRef.current = false;
    },
    [sidebarCollapsed],
  );

  return (
    <div className="unified-app">
      <UnifiedSidebar
        view={view}
        collapsed={sidebarCollapsed}
        websiteLoadState={websiteLoadState}
        websiteLoadError={websiteLoadError}
        groupedSessions={groupedSessions}
        selectedSession={selectedSession}
        onCollapsedChange={handleSidebarCollapsedChange}
        onViewChange={handleViewChange}
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
        onCreateWebsite={() => {
          setSelectedTemplateForCreate(null);
          setCreateWebsiteOpen(true);
        }}
        onSettingsOpen={handleAuthorizeWebsite}
        onSessionRename={handleRenameSession}
        onSessionPin={handlePinSession}
        onSessionClone={handleCloneSession}
        onSessionDelete={handleDeleteSession}
        onRetryWebsites={() => void loadWebsites()}
      />
      <div className="unified-content">
        {view === 'templates' ? (
          <TemplatesView
            onUseTemplate={(template) => {
              setSelectedTemplateForCreate(template);
              setCreateWebsiteOpen(true);
            }}
          />
        ) : canRenderSelectedWorkbench ? (
          <AgentWorkbenchContent
            websiteId={selectedWebsite!}
            sessionId={selectedSession!}
            sessionMetadata={sessions
              .filter((session) => session.websiteId === selectedWebsite)
              .map(({ id, title }) => ({ id, title }))}
            onSessionChange={handleSessionChange}
            onSettingsOpen={() => setSettingsWebsiteId(selectedWebsite)}
            initialPrompt={
              pendingStartPrompt?.websiteId === selectedWebsite ? pendingStartPrompt : undefined
            }
            onInitialPromptConsumed={handleInitialPromptConsumed}
            onPreviewOpenChange={handlePreviewOpenChange}
          />
        ) : websiteLoadState === 'loading' ? (
          <main className="workspace-loading-state" aria-busy="true" aria-live="polite">
            <div className="workspace-loading-card">
              <div className="workspace-loading-copy">
                <h1>{t('loading')}</h1>
              </div>
              <div className="workspace-loading-progress" aria-hidden="true">
                <span />
              </div>
              <div className="workspace-loading-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </main>
        ) : websiteLoadState === 'error' ? (
          <main className="workspace-empty-state">
            <div className="workspace-empty-state-inner">
              <h1>{t('loadError')}</h1>
              <p>{websiteLoadError}</p>
              <button className="primary-button" type="button" onClick={() => void loadWebsites()}>
                {t('retry')}
              </button>
            </div>
          </main>
        ) : websites.length === 0 ? (
          <main className="workspace-empty-state">
            <div className="workspace-empty-state-inner">
              <h1>{t('onboardingTitle')}</h1>
              <div className="workspace-empty-state-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setSelectedTemplateForCreate(null);
                    setCreateWebsiteOpen(true);
                  }}
                >
                  {t('create')}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => handleViewChange('templates')}
                >
                  {t('browseTemplates')}
                </button>
              </div>
            </div>
          </main>
        ) : (
          <WorkspaceStart
            websites={websites}
            selectedWebsiteId={selectedWebsite}
            prompt={startPrompt}
            submitting={startSubmitting}
            error={startError}
            onWebsiteChange={(websiteId) => {
              setSelectedWebsite(websiteId);
              setSelectedSession(null);
              setStartError('');
            }}
            onPromptChange={setStartPrompt}
            onSubmit={() => void handleStartPrompt()}
            onAuthorizeWebsite={handleAuthorizeWebsite}
          />
        )}
      </div>
      <WebsiteCreateDialog
        key={`website-create-${createWebsiteOpen ? 'open' : 'closed'}`}
        open={createWebsiteOpen}
        onClose={() => {
          setCreateWebsiteOpen(false);
          setSelectedTemplateForCreate(null);
        }}
        onCreated={handleWebsiteCreated}
        template={selectedTemplateForCreate}
      />
      <WebsiteSettingsDialog
        key={`website-settings-${settingsWebsiteId ?? 'closed'}`}
        website={settingsWebsite}
        onClose={() => {
          setSettingsWebsiteId(null);
        }}
        onAuthorized={handleAuthorizationComplete}
        onTemplateRetried={() => {
          if (!settingsWebsiteId) return;
          setWebsites((current) =>
            current.map((website) =>
              website.id === settingsWebsiteId
                ? { ...website, status: 'authorization_required' }
                : website,
            ),
          );
        }}
        onDeleteStart={() => {
          if (settingsWebsiteId) setDeletingWebsiteId(settingsWebsiteId);
        }}
        onDeleted={handleDeleteWebsite}
      />
    </div>
  );
}
