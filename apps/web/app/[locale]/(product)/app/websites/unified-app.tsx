'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UnifiedSidebar } from './components/unified-sidebar';
import { WebsitesView } from './components/websites-view';
import { AgentWorkbenchContent } from './components/agent-workbench-content';
import { ConversationsView } from './components/conversations-view';
import { TemplatesView } from './components/templates-view';
import './websites.css';

export type WorkspaceView = 'websites' | 'templates' | 'conversations';

export type WorkspaceInitialState = {
  view?: WorkspaceView;
  websiteId?: string | null;
  sessionId?: string | null;
};

type Website = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  previewUrl?: string;
};

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

export function UnifiedApp({ initialState }: { initialState?: WorkspaceInitialState }) {
  const t = useTranslations('websites');
  const [view, setView] = useState<WorkspaceView>(initialState?.view ?? 'websites');
  const [selectedWebsite, setSelectedWebsite] = useState<string | null>(
    initialState?.view === 'conversations' ? (initialState.websiteId ?? null) : null,
  );
  const [selectedSession, setSelectedSession] = useState<string | null>(
    initialState?.view === 'conversations' ? (initialState.sessionId ?? null) : null,
  );
  const [websites, setWebsites] = useState<Website[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [createSessionRequest, setCreateSessionRequest] = useState(0);
  useEffect(() => {
    async function loadData() {
      try {
        const websitesRes = await fetch('/api/websites');
        if (!websitesRes.ok) throw new Error(t('loadError'));
        const websitesData = (await websitesRes.json()) as Website[];
        const sessionsRes = await fetch('/api/sessions');
        if (!sessionsRes.ok) throw new Error(t('loadError'));
        const sessionsData = (await sessionsRes.json()) as Session[];

        setWebsites(websitesData);
        setSessions(sessionsData);
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    }
    void loadData();
  }, [t]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (view !== 'websites') query.set('view', view);
    if (selectedWebsite) query.set('websiteId', selectedWebsite);
    if (selectedSession) query.set('sessionId', selectedSession);
    const nextUrl = `${window.location.pathname}${query.toString() ? `?${query}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, [view, selectedWebsite, selectedSession]);

  const groupedSessions: GroupedSessions[] = websites.map((website) => ({
    websiteId: website.id,
    websiteName: website.name,
    sessions: sessions
      .filter((s) => s.websiteId === website.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  }));

  function handleWebsiteSelect(websiteId: string) {
    setCreateSessionRequest(0);
    setSelectedWebsite(websiteId);
    setSelectedSession(null);
    setView('conversations');
  }

  function handleViewChange(nextView: WorkspaceView) {
    setView(nextView);
    if (nextView === 'websites') {
      setSelectedWebsite(null);
      setSelectedSession(null);
    }
    if (nextView !== 'conversations') setCreateSessionRequest(0);
  }

  function handleSessionSelect(websiteId: string, sessionId: string) {
    setCreateSessionRequest(0);
    setSelectedWebsite(websiteId);
    setSelectedSession(sessionId);
    setView('conversations');
  }

  function handleNewSession(websiteId: string) {
    setSelectedWebsite(websiteId);
    setSelectedSession(null);
    setView('conversations');
    setCreateSessionRequest((current) => current + 1);
  }

  const handleSessionChange = useCallback(
    (newSessionId: string) => {
      setCreateSessionRequest(0);
      setSelectedSession(newSessionId);
      setSessions((current) =>
        current.some((s) => s.id === newSessionId)
          ? current
          : [
              ...current,
              {
                id: newSessionId,
                websiteId: selectedWebsite ?? '',
                title: '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
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
      />
      <div className="unified-content">
        {view === 'websites' ? (
          <WebsitesView websites={websites} onWebsiteSelect={handleWebsiteSelect} />
        ) : view === 'templates' ? (
          <TemplatesView />
        ) : selectedWebsite ? (
          <AgentWorkbenchContent
            websiteId={selectedWebsite}
            sessionId={selectedSession || undefined}
            onSessionChange={handleSessionChange}
            createSessionRequest={createSessionRequest}
          />
        ) : (
          <ConversationsView />
        )}
      </div>
    </div>
  );
}
