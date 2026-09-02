'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentEnvelope, AgentEvent } from '@cloudcrane/agent-protocol';
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
import type {
  PreviewState,
  Session,
} from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/types';
import '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/agent-workbench.css';

// Simplified workbench without SessionSidebar (managed by UnifiedSidebar)
export function AgentWorkbenchContent({
  websiteId,
  sessionId,
  onSessionChange,
}: {
  websiteId: string;
  sessionId?: string;
  onSessionChange?: (sessionId: string) => void;
}) {
  const t = useTranslations('workbench');
  const [conversation, dispatchConversation] = useReducer(
    conversationReducer,
    initialConversationState,
  );
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(sessionId);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runId, setRunId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [previewKey, setPreviewKey] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState<
    'unavailable' | 'attached' | 'detached' | 'error'
  >('unavailable');
  const [previewViewportMode, setPreviewViewportMode] = useState<PreviewViewportMode>('desktop');

  const socket = useRef<WebSocket | null>(null);
  const previewFrame = useRef<HTMLIFrameElement | null>(null);
  const previewClient = useRef<PreviewBridgeClient | null>(null);
  const pendingConversationQueue = useRef<ConversationEvent[]>([]);
  const activeRunRef = useRef<string | undefined>(undefined);
  const previewUrlPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const pendingSessionTitlesRef = useRef(new Map<string, { sessionId: string; title: string }>());

  activeRunRef.current = runId;

  const flushConversation = useCallback(() => {
    const queue = pendingConversationQueue.current;
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    dispatchConversation({ type: 'batch', actions: batch });
  }, []);

  const queueConversation = useCallback(
    (event: ConversationEvent, immediate = false) => {
      pendingConversationQueue.current.push(event);
      if (immediate) flushConversation();
    },
    [flushConversation],
  );

  const sendCommand = useCallback((input: Parameters<typeof command>[0], requestId?: string) => {
    const next = command(input);
    if (requestId) next.requestId = requestId;
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(next));
  }, []);

  const loadPreviewUrl = useCallback(async () => {
    if (previewUrlPromiseRef.current) return previewUrlPromiseRef.current;
    const promise = getPreviewUrl(websiteId).then(({ url }) => {
      setPreview({ status: 'ready', url });
      return url;
    });
    previewUrlPromiseRef.current = promise;
    return promise;
  }, [websiteId]);

  const refreshPreview = useCallback(() => {
    if (previewClient.current)
      void previewClient.current
        .refresh()
        .catch((cause) =>
          setError(cause instanceof Error ? cause.message : t('operationIncomplete')),
        );
    else setPreviewKey((current) => current + 1);
  }, [t]);

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
          if (firstSessionId) {
            setCurrentSessionId(firstSessionId);
            onSessionChange?.(firstSessionId);
          }
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

  function submit() {
    const text = draft.trim();
    if (!text || !currentSessionId || activeRunRef.current) return;
    const requestId = crypto.randomUUID();
    queueConversation(
      {
        type: 'user.added',
        payload: { message: { id: requestId, requestId, role: 'user', text, status: 'pending' } },
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
    if (currentSessionId)
      sendCommand({ type: 'agent.abort', websiteId, sessionId: currentSessionId, payload: {} });
  };

  const requestPreview = useCallback(
    async (payload: Extract<AgentEvent, { type: 'preview.request' }>['payload']) => {
      const client = previewClient.current;
      if (!client)
        throw new PreviewBridgeClientError('PREVIEW_PROTOCOL_ERROR', 'Preview Client unavailable');
      return handlePreviewRequest(client, payload);
    },
    [],
  );

  const schedulePreviewRefresh = useCallback(() => {
    refreshPreview();
  }, [refreshPreview]);

  useEffect(() => {
    if (!previewOpen || preview.status !== 'ready' || !preview.url || !previewFrame.current) return;
    const client = new PreviewBridgeClient(previewFrame.current, preview.url, () => {
      setBridgeStatus('attached');
    });
    previewClient.current = client;
    return () => {
      client.dispose();
      if (previewClient.current === client) previewClient.current = null;
      setBridgeStatus('unavailable');
    };
  }, [previewOpen, preview.status, preview.url]);

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
        sendCommand({
          type: 'session.attach',
          websiteId,
          payload: { sessionId: currentSessionId },
        });
      };

      ws.onclose = () => {
        if (disposed) return;
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
        if (projected.envelope.sessionId && projected.envelope.sessionId !== currentSessionId)
          return;
        if (
          projected.envelope.runId &&
          activeRunRef.current &&
          projected.envelope.runId !== activeRunRef.current &&
          projected.event.type !== 'run.started'
        )
          return;

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
                      code:
                        cause instanceof PreviewBridgeClientError
                          ? cause.code
                          : 'PREVIEW_PROTOCOL_ERROR',
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

        if (projected.event.type === 'run.settled') {
          setRunId(undefined);
        }

        handleEvent(
          projected.event,
          projected.envelope,
          queueConversation,
          flushConversation,
          setRunId,
          setError,
          schedulePreviewRefresh,
        );
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket.current?.close();
      socket.current = null;
    };
  }, [
    websiteId,
    currentSessionId,
    sendCommand,
    requestPreview,
    queueConversation,
    flushConversation,
    schedulePreviewRefresh,
    t,
  ]);

  return (
    <main className="workbench">
      <div
        className={`workbench-body no-session-sidebar ${previewOpen ? 'preview-open' : 'preview-closed'}`}
      >
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
          onPreviewViewportModeChange={setPreviewViewportMode}
        />
      </div>
    </main>
  );
}

async function handlePreviewRequest(
  client: PreviewBridgeClient,
  request: Extract<AgentEvent, { type: 'preview.request' }>['payload'],
) {
  if (request.operation === 'observe')
    return { ok: true as const, observation: await client.observe() };
  if (request.operation === 'refresh')
    return { ok: true as const, observation: await client.refresh() };
  return { ok: true as const, observation: await client.navigate(request.path) };
}

function handleEvent(
  event: AgentEvent,
  envelope: AgentEnvelope,
  queueConversation: (action: ConversationEvent, immediate?: boolean) => void,
  flushConversation: () => void,
  setRunId: (value: string | undefined) => void,
  setError: (value: string | undefined) => void,
  schedulePreviewRefresh: () => void,
) {
  if (event.type === 'run.started') setRunId(event.payload.runId);
  if (event.type === 'run.settled') {
    flushConversation();
    queueConversation(
      {
        type: 'run.settled',
        payload: {
          status: event.payload.status,
          ...(event.payload.error ? { error: event.payload.error } : {}),
          ...(event.payload.finalMessageId ? { finalMessageId: event.payload.finalMessageId } : {}),
          runId: event.payload.runId ?? envelope.runId,
          traceId: event.payload.traceId ?? envelope.traceId,
        },
      },
      true,
    );
    setRunId(undefined);
    schedulePreviewRefresh();
  }
  if (event.type === 'command.ack')
    queueConversation(
      { type: 'message.status', payload: { requestId: envelope.requestId, status: 'accepted' } },
      true,
    );
  if (event.type === 'command.error') {
    setError(event.payload.message);
    queueConversation(
      { type: 'message.status', payload: { requestId: envelope.requestId, status: 'failed' } },
      true,
    );
  }
  if (event.type === 'session.snapshot') {
    flushConversation();
    queueConversation(
      {
        type: 'session.snapshot',
        payload: {
          messages: event.payload.messages,
          session: event.payload.session,
          activeRun: event.payload.activeRun,
        },
      },
      true,
    );
    setRunId(event.payload.activeRun?.runId);
  }
  if (event.type === 'turn.started')
    queueConversation({ type: 'turn.started', payload: event.payload }, true);
  if (event.type === 'turn.completed')
    queueConversation({ type: 'turn.completed', payload: event.payload }, true);
  if (event.type === 'assistant.started')
    queueConversation({ type: 'assistant.started', payload: event.payload });
  if (event.type === 'assistant.delta')
    queueConversation({ type: 'assistant.delta', payload: event.payload });
  if (event.type === 'assistant.completed')
    queueConversation({ type: 'assistant.completed', payload: event.payload }, true);
  if (event.type === 'tool.started')
    queueConversation({ type: 'tool.started', payload: event.payload });
  if (event.type === 'tool.updated')
    queueConversation({ type: 'tool.updated', payload: event.payload });
  if (event.type === 'tool.completed') {
    queueConversation({ type: 'tool.completed', payload: event.payload }, true);
    if (['edit', 'write', 'bash'].includes(event.payload.toolName)) schedulePreviewRefresh();
  }
}
