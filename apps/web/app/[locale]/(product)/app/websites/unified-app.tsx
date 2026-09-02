'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UnifiedSidebar } from './components/unified-sidebar';
import { WebsitesView } from './components/websites-view';
import { AgentWorkbenchContent } from './components/agent-workbench-content';
import './websites.css';

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

export function UnifiedApp() {
  const t = useTranslations('websites');
  const [view, setView] = useState<'websites' | 'conversations'>('websites');
  const [selectedWebsite, setSelectedWebsite] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const websitesRes = await fetch('/api/websites');
        console.log('Websites response status:', websitesRes.status);
        const websitesText = await websitesRes.text();
        console.log('Websites raw response:', websitesText);
        const websitesData = JSON.parse(websitesText) as Website[];

        const sessionsRes = await fetch('/api/sessions');
        console.log('Sessions response status:', sessionsRes.status);
        const sessionsText = await sessionsRes.text();
        console.log('Sessions raw response:', sessionsText);
        const sessionsData = JSON.parse(sessionsText) as Session[];

        setWebsites(websitesData);
        setSessions(sessionsData);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  const groupedSessions: GroupedSessions[] = websites.map((website) => ({
    websiteId: website.id,
    websiteName: website.name,
    sessions: sessions
      .filter((s) => s.websiteId === website.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  }));

  function handleWebsiteSelect(websiteId: string) {
    setSelectedWebsite(websiteId);
    setSelectedSession(null);
    setView('conversations');
  }

  function handleSessionSelect(websiteId: string, sessionId: string) {
    setSelectedWebsite(websiteId);
    setSelectedSession(sessionId);
  }

  function handleNewSession(websiteId: string) {
    setSelectedWebsite(websiteId);
    setSelectedSession(null);
  }

  return (
    <div className="unified-app">
      <UnifiedSidebar
        view={view}
        websites={websites}
        groupedSessions={groupedSessions}
        selectedWebsite={selectedWebsite}
        selectedSession={selectedSession}
        onViewChange={setView}
        onWebsiteSelect={handleWebsiteSelect}
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
      />
      <div className="unified-content">
        {view === 'websites' && !selectedWebsite ? (
          <WebsitesView websites={websites} onWebsiteSelect={handleWebsiteSelect} />
        ) : selectedWebsite ? (
          <AgentWorkbenchContent
            websiteId={selectedWebsite}
            sessionId={selectedSession || undefined}
            onSessionChange={(newSessionId) => {
              setSelectedSession(newSessionId);
              setSessions((current) =>
                current.some((s) => s.id === newSessionId)
                  ? current
                  : [
                      ...current,
                      {
                        id: newSessionId,
                        websiteId: selectedWebsite,
                        title: '',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                      },
                    ],
              );
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
