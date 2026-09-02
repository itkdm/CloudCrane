'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { listAgentSessions } from '@/lib/agent-client';
import { UnifiedSidebar } from './components/unified-sidebar';
import { AgentWorkbenchContent } from './components/agent-workbench-content';
import { TemplatesView } from './components/templates-view';
import { WebsiteCreateDialog, type CreatedWebsite } from './components/website-create-dialog';
import { WebsiteAuthorizationDialog } from './components/website-authorization-dialog';
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
  const [createSessionRequest, setCreateSessionRequest] = useState(0);
  const [createWebsiteOpen, setCreateWebsiteOpen] = useState(false);
  const [authorizationWebsiteId, setAuthorizationWebsiteId] = useState<string | null>(null);
  const [websiteLoadState, setWebsiteLoadState] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [websiteLoadError, setWebsiteLoadError] = useState('');

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
    setCreateSessionRequest(0);
  }

  function handleSessionSelect(websiteId: string, sessionId: string) {
    setCreateSessionRequest(0);
    setSelectedWebsite(websiteId);
    setSelectedSession(sessionId);
    setView('websites');
  }

  function handleNewSession(websiteId: string) {
    setSelectedWebsite(websiteId);
    setSelectedSession(null);
    setView('websites');
    setCreateSessionRequest((current) => current + 1);
  }

  function handleWebsiteCreated(website: Website) {
    setWebsites((current) => [...current, website]);
    setCreateWebsiteOpen(false);
    setSelectedSession(null);
    setView('websites');
    if (website.status === 'authorization_required') {
      setSelectedWebsite(null);
      setAuthorizationWebsiteId(website.id);
      return;
    }
    if (website.status === 'ready') {
      setSelectedWebsite(website.id);
      setCreateSessionRequest((current) => current + 1);
      return;
    }
    setSelectedWebsite(null);
  }

  function handleAuthorizeWebsite(websiteId: string) {
    setAuthorizationWebsiteId(websiteId);
  }

  function handleAuthorizationComplete() {
    if (!authorizationWebsiteId) return;
    const websiteId = authorizationWebsiteId;
    setWebsites((current) =>
      current.map((website) =>
        website.id === websiteId ? { ...website, status: 'ready' } : website,
      ),
    );
    setAuthorizationWebsiteId(null);
    setSelectedWebsite(websiteId);
    setSelectedSession(null);
    setView('websites');
    setCreateSessionRequest((current) => current + 1);
  }

  const authorizationWebsite =
    websites.find((website) => website.id === authorizationWebsiteId) ?? null;

  const handleSessionChange = useCallback(
    (change: SessionChange) => {
      const metadata = typeof change === 'string' ? { id: change } : change;
      setCreateSessionRequest(0);
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

  return (
    <div className="unified-app">
      <UnifiedSidebar
        view={view}
        groupedSessions={groupedSessions}
        selectedSession={selectedSession}
        onViewChange={handleViewChange}
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
        onCreateWebsite={() => setCreateWebsiteOpen(true)}
        onAuthorizeWebsite={handleAuthorizeWebsite}
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
        ) : selectedWebsite ? (
          <AgentWorkbenchContent
            websiteId={selectedWebsite}
            sessionId={selectedSession || undefined}
            onSessionChange={handleSessionChange}
            createSessionRequest={createSessionRequest}
          />
        ) : websites.length === 0 ? (
          <main className="workspace-empty-state">
            <div className="workspace-empty-state-inner">
              <span className="workspace-empty-state-eyebrow">CloudCrane</span>
              <h1>{t('onboardingTitle')}</h1>
              <p>{t('onboardingDescription')}</p>
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
          <main className="workspace-empty-state">
            <div className="workspace-empty-state-inner">
              <h1>{t('selectWorkspaceTitle')}</h1>
              <p>{t('selectWorkspaceDescription')}</p>
            </div>
          </main>
        )}
      </div>
      <WebsiteCreateDialog
        key={createWebsiteOpen ? 'open' : 'closed'}
        open={createWebsiteOpen}
        onClose={() => setCreateWebsiteOpen(false)}
        onCreated={handleWebsiteCreated}
      />
      <WebsiteAuthorizationDialog
        key={authorizationWebsiteId ?? 'closed'}
        website={authorizationWebsite}
        onClose={() => setAuthorizationWebsiteId(null)}
        onAuthorized={handleAuthorizationComplete}
      />
    </div>
  );
}
