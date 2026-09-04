'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createAgentSession, listAgentSessions } from '@/lib/agent-client';
import { UnifiedSidebar } from './components/unified-sidebar';
import { AgentWorkbenchContent } from './components/agent-workbench-content';
import { TemplatesView } from './components/templates-view';
import { WebsiteCreateDialog, type CreatedWebsite } from './components/website-create-dialog';
import { WebsiteSettingsDialog } from './components/website-settings-dialog';
import { WorkspaceStart } from './components/workspace-start';
import './websites.css';

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

function canEnterWorkspace(website: Website | undefined): website is Website {
  return website?.status === 'ready';
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
  const [createWebsiteOpen, setCreateWebsiteOpen] = useState(false);
  const [settingsWebsiteId, setSettingsWebsiteId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
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

  const loadWebsites = useCallback(async () => {
    setWebsiteLoadState('loading');
    setWebsiteLoadError('');
    try {
      const websitesRes = await fetch('/api/websites');
      if (!websitesRes.ok) throw new Error(t('loadError'));
      const websitesData = (await websitesRes.json()) as Website[];
      const sessionResults = await Promise.allSettled(
        websitesData.map(async (website) => {
          const result = await listAgentSessions(website.id);
          return result.sessions.map((session) => ({
            ...session,
            websiteId: website.id,
            title: session.title ?? undefined,
          }));
        }),
      );
      setWebsites(websitesData);
      setSessions(
        sessionResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
      );
      setWebsiteLoadState('success');
    } catch (error) {
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
    const query = new URLSearchParams();
    if (view !== 'websites') query.set('view', view);
    if (selectedWebsite) query.set('websiteId', selectedWebsite);
    if (selectedSession) query.set('sessionId', selectedSession);
    const nextUrl = `${window.location.pathname}${query.toString() ? `?${query}` : ''}`;
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
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      })),
    [sessions, websites],
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
        groupedSessions={groupedSessions}
        selectedSession={selectedSession}
        onCollapsedChange={handleSidebarCollapsedChange}
        onViewChange={handleViewChange}
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
        onCreateWebsite={() => setCreateWebsiteOpen(true)}
        onSettingsOpen={handleAuthorizeWebsite}
      />
      <div className="unified-content">
        {view === 'templates' ? (
          <TemplatesView />
        ) : websiteLoadState === 'loading' ? (
          <main className="workspace-empty-state">
            <div className="workspace-empty-state-inner">
              <h1>{t('loading')}</h1>
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
        ) : selectedWebsite && selectedSession && canEnterWorkspace(selectedWebsiteRecord) ? (
            <AgentWorkbenchContent
            websiteId={selectedWebsite}
            sessionId={selectedSession}
            onSessionChange={handleSessionChange}
            onSettingsOpen={() => setSettingsWebsiteId(selectedWebsite)}
            initialPrompt={
              pendingStartPrompt?.websiteId === selectedWebsite ? pendingStartPrompt : undefined
            }
            onInitialPromptConsumed={handleInitialPromptConsumed}
            onPreviewOpenChange={handlePreviewOpenChange}
          />
        ) : websites.length === 0 ? (
          <main className="workspace-empty-state">
            <div className="workspace-empty-state-inner">
              <span className="workspace-empty-state-eyebrow">CloudCrane</span>
              <h1>{t('onboardingTitle')}</h1>
              <div className="workspace-empty-state-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setCreateWebsiteOpen(true)}
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
        onClose={() => setCreateWebsiteOpen(false)}
        onCreated={handleWebsiteCreated}
      />
      <WebsiteSettingsDialog
        key={`website-settings-${settingsWebsiteId ?? 'closed'}`}
        website={settingsWebsite}
        onClose={() => {
          setSettingsWebsiteId(null);
        }}
        onAuthorized={handleAuthorizationComplete}
      />
    </div>
  );
}
