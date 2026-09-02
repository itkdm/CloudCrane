'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentEnvelope, AgentEvent, PreviewCapability } from '@cloudcrane/agent-protocol';
import { deriveSessionTitle } from '@cloudcrane/shared/session-title';
import {
  agentWebSocketUrl,
  command,
  createAgentSession,
  getPreviewUrl,
  listAgentSessions,
  parseAgentEvent,
  parseAgentMessage,
} from '@/lib/agent-client';
import { PreviewBridgeClient, PreviewBridgeClientError } from '@/lib/preview-bridge-client';
import { ChatPanel } from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/chat-panel';
import {
  conversationReducer,
  initialConversationState,
  type ConversationEvent,
} from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/conversation-reducer';
import { PreviewPane } from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/preview-pane';
import type { PreviewViewportMode } from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/preview-viewport';
import type { PreviewState, Session } from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/types';
import '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/agent-workbench.css';

// Simplified workbench without SessionSidebar (managed by UnifiedSidebar)
export function AgentWorkbenchContent({
  websiteId,
  sessionId,
  onSessionChange
}: {
  websiteId: string;
  sessionId?: string;
  onSessionChange?: (sessionId: string) => void;
}) {
  const t = useTranslations('workbench');
  const [conversation, queueConversation] = useReducer(
    conversationReducer,
    undefined,
    initialConversationState,
  );
  const [connection, setConnection] = useState<
    'unavailable' | 'connecting' | 'connected' | 'reconnecting'
  >('connecting');
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(sessionId);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runId, setRunId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ url: undefined });
  const [previewKey, setPreviewKey] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState<
    'unavailable' | 'attached' | 'detached' | 'error'
  >('unavailable');
  const [previewViewportMode, setPreviewViewportMode] = useState<PreviewViewportMode>('desktop');

  const socket = useRef<WebSocket | null>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const previewClient = useRef<PreviewBridgeClient | null>(null);
  const pendingConversationQueue = useRef<ConversationEvent[]>([]);
  const activeRunRef = useRef<string | undefined>();
  const previewUrlPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const pendingSessionTitlesRef = useRef(new Map<string, { sessionId: string; title: string }>());

  activeRunRef.current = runId;

  const flushConversation = useCallback(
    (force = false) => {
      const queue = pendingConversationQueue.current;
      if (queue.length === 0) return;
      const batch = queue.splice(0, queue.length);
      queueConversation({ type: 'batch', payload: { events: batch } }, force);
    },
    [queueConversation],
  );

  const sendCommand = useCallback((cmd: ReturnType<typeof command>, requestId?: string) => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ ...cmd, ...(requestId && { requestId }) }));
  }, []);

  const loadPreviewUrl = useCallback(async () => {
    if (previewUrlPromiseRef.current) return previewUrlPromiseRef.current;
    const promise = getPreviewUrl(websiteId).then(
      (response) => response.url,
      () => undefined,
    );
    previewUrlPromiseRef.current = promise;
    return promise;
  }, [websiteId]);

  const registerPreviewClient = useCallback(async () => {
    const frame = previewFrame.current;
    if (!frame?.contentWindow) return;
    const url = await loadPreviewUrl();
    if (!url) return;
    const client = new PreviewBridgeClient(
      frame.contentWindow,
      new URL(url).origin,
      (status) => {
        if (status === 'attached') setPreview((current) => ({ ...current, ready: true }));
        setBridgeStatus(status);
      },
      (capability) => {
        setPreview((current) => ({ ...current, capabilities: capability }));
      },
    );
    previewClient.current = client;
    return client;
  }, [loadPreviewUrl]);

  const refreshPreview = useCallback(() => setPreviewKey((current) => current + 1), []);

  useEffect(() => {
    const timer = setInterval(() => flushConversation(), 200);
    return () => clearInterval(timer);
  }, [flushConversation]);

  useEffect(() => {
    loadPreviewUrl()
      .then((url) => setPreview((current) => ({ ...current, url })))
      .catch(() => {});
    return () => {
      previewUrlPromiseRef.current = null;
    };
  }, [loadPreviewUrl]);

  // Load session list
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listAgentSessions(websiteId);
        if (cancelled) return;
        let next = result.sessions;
        if (next.length === 0) next = [(await createAgentSession(websiteId)).session];
        setSessions(next);
        if (!sessionId) {
          const firstSessionId = next[0]?.id;
          setCurrentSessionId(firstSessionId);
          onSessionChange?.(firstSessionId);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('operationIncomplete'));
      }
    })();
    return () => {
      cancelled = true;
      socket.current?.close();
    };
  }, [websiteId, sessionId, onSessionChange, t]);

  // Listen to external sessionId changes
  useEffect(() => {
    if (sessionId && sessionId !== currentSessionId) {
      flushConversation();
      queueConversation({ type: 'session.snapshot', payload: { messages: [] } }, true);
      setRunId(undefined);
      setError(undefined);
      setCurrentSessionId(sessionId);
    }
  }, [sessionId, currentSessionId, flushConversation]);

  // WebSocket connection
  useEffect(() => {
    if (!currentSessionId) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(agentWebSocketUrl());
      socket.current = ws;
      ws.onopen = () => {
        if (disposed || socket.current !== ws) return;
        setConnection('connected');
        sendCommand({ type: 'session.attach', websiteId, payload: { sessionId: currentSessionId } });
        registerPreviewClient();
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnection('reconnecting');
        retryTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        if (disposed || socket.current !== ws) return;
        setError(t('connectionInterrupted'));
      };
      ws.onmessage = (event) => {
        if (disposed || socket.current !== ws) return;
        const message = parseAgentMessage(String(event.data));
        const projected = message ? parseAgentEvent(message) : null;
        if (!projected) return;
        if (projected.envelope.websiteId && projected.envelope.websiteId !== websiteId) return;
        if (projected.envelope.sessionId && projected.envelope.sessionId !== currentSessionId) return;
        if (
          projected.envelope.runId &&
          activeRunRef.current &&
          projected.envelope.runId !== activeRunRef.current &&
          projected.event.type !== 'run.started'
        )
          return;

        // Handle session updates
        if (
          projected.event.type === 'session.attached' ||
          projected.event.type === 'session.snapshot'
        ) {
          const nextSession = projected.event.payload.session;
          setSessions((current) => {
            const existing = current.some((session) => session.id === nextSession.id);
            return existing
              ? current.map((session) =>
                  session.id === nextSession.id ? { ...session, ...nextSession } : session,
                )
              : [nextSession, ...current];
          });
        }

        // Other event handling...
        pendingConversationQueue.current.push(projected.event);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socket.current?.close();
      socket.current = null;
    };
  }, [websiteId, currentSessionId, sendCommand, registerPreviewClient, t]);

  function submit(text: string) {
    const requestId = crypto.randomUUID();
    queueConversation(
      {
        type: 'message.user',
        payload: { text, requestId, timestamp: new Date().toISOString() },
      },
      true,
    );
    if (socket.current?.readyState === WebSocket.OPEN) {
      const currentSession = sessions.find((session) => session.id === currentSessionId);
      if (!currentSession?.title?.trim() && currentSessionId)
        pendingSessionTitlesRef.current.set(requestId, {
          sessionId: currentSessionId,
          title: deriveSessionTitle(text),
        });
      socket.current.send(
        JSON.stringify({
          ...command({
            type: 'agent.prompt',
            websiteId,
            sessionId: currentSessionId!,
            payload: { text, promptRequestId: requestId },
          }),
          requestId,
        }),
      );
    } else {
      pendingSessionTitlesRef.current.delete(requestId);
      queueConversation({ type: 'message.status', payload: { requestId, status: 'failed' } }, true);
      setError(t('connectionInterrupted'));
    }
    setDraft('');
  }

  const stop = () => {
    if (currentSessionId) sendCommand({ type: 'agent.abort', websiteId, sessionId: currentSessionId, payload: {} });
  };

  const requestPreview = useCallback(
    async (payload: { capability: PreviewCapability }) => {
      const client = previewClient.current;
      if (!client) throw new PreviewBridgeClientError('bridge_unavailable');
      return client.request(payload.capability);
    },
    [],
  );

  const schedulePreviewRefresh = useCallback(() => {
    refreshPreview();
  }, [refreshPreview]);

  // Handle WebSocket events
  useEffect(() => {
    if (!currentSessionId) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(agentWebSocketUrl());
      socket.current = ws;

      ws.onopen = () => {
        if (disposed || socket.current !== ws) return;
        setConnection('connected');
        sendCommand({ type: 'session.attach', websiteId, payload: { sessionId: currentSessionId } });
        void registerPreviewClient();
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnection('reconnecting');
        retryTimer = setTimeout(connect, 1500);
      };

      ws.onerror = () => {
        if (disposed || socket.current !== ws) return;
        setError(t('connectionInterrupted'));
      };

      ws.onmessage = (event) => {
        if (disposed || socket.current !== ws) return;
        const message = parseAgentMessage(String(event.data));
        const projected = message ? parseAgentEvent(message) : null;
        if (!projected) return;

        if (projected.envelope.websiteId && projected.envelope.websiteId !== websiteId) return;
        if (projected.envelope.sessionId && projected.envelope.sessionId !== currentSessionId) return;
        if (
          projected.envelope.runId &&
          activeRunRef.current &&
          projected.envelope.runId !== activeRunRef.current &&
          projected.event.type !== 'run.started'
        ) return;

        // Handle session updates
        if (
          projected.event.type === 'session.attached' ||
          projected.event.type === 'session.snapshot'
        ) {
          const nextSession = projected.event.payload.session;
          setSessions((current) => {
            const existing = current.some((session) => session.id === nextSession.id);
            return existing
              ? current.map((session) =>
                  session.id === nextSession.id ? { ...session, ...nextSession } : session,
                )
              : [nextSession, ...current];
          });
        }

        // Handle preview requests
        if (projected.event.type === 'preview.request') {
          void requestPreview(projected.event.payload)
            .then((payload) => {
              sendCommand(
                { type: 'preview.response', websiteId, sessionId: currentSessionId, payload },
                projected.envelope.requestId,
              );
            })
            .catch((cause) => {
              sendCommand(
                {
                  type: 'preview.response',
                  websiteId,
                  sessionId: currentSessionId,
                  payload: {
                    ok: false,
                    error: {
                      code: cause instanceof PreviewBridgeClientError ? cause.code : 'unknown',
                      message: cause instanceof Error ? cause.message : 'Preview request failed',
                    },
                  },
                },
                projected.envelope.requestId,
              );
            });
          return;
        }

        // Handle command acknowledgment for session titles
        if (projected.event.type === 'command.ack') {
          const pendingTitle = pendingSessionTitlesRef.current.get(projected.envelope.requestId);
          if (pendingTitle) {
            pendingSessionTitlesRef.current.delete(projected.envelope.requestId);
            setSessions((current) =>
              current.map((session) =>
                session.id === pendingTitle.sessionId
                  ? { ...session, title: pendingTitle.title }
                  : session,
              ),
            );
          }
        }

        if (projected.event.type === 'command.error') {
          pendingSessionTitlesRef.current.delete(projected.envelope.requestId);
        }

        if (projected.event.type === 'run.started') {
          setRunId(projected.envelope.runId);
        }

        if (projected.event.type === 'run.completed' || projected.event.type === 'run.failed') {
          setRunId(undefined);
        }

        // Queue all events for conversation
        pendingConversationQueue.current.push(projected.event);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket.current?.close();
      socket.current = null;
    };
  }, [websiteId, currentSessionId, sendCommand, registerPreviewClient, requestPreview, t]);

  return (
    <main className="workbench">
      <div className={`workbench-body no-session-sidebar ${previewOpen ? 'preview-open' : 'preview-closed'}`}>
        <ChatPanel
          turns={conversation.turns}
          draft={draft}
          running={Boolean(runId)}
          error={error}
          disabled={!currentSessionId}
          onDraftChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          onDismissError={() => setError(undefined)}
          onExample={setDraft}
        />
        <PreviewPane
          preview={preview}
          open={previewOpen}
          previewKey={previewKey}
          frameRef={previewFrame}
          bridgeStatus={bridgeStatus}
          onClose={() => setPreviewOpen(false)}
          onOpenPanel={() => setPreviewOpen(true)}
          onRefresh={refreshPreview}
          onOpen={() => preview.url && window.open(preview.url, '_blank', 'noopener,noreferrer')}
          previewViewportMode={previewViewportMode}
          onChangeViewportMode={setPreviewViewportMode}
        />
      </div>
    </main>
  );
}
