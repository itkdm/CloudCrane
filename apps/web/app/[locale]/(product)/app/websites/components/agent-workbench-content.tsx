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
  createSessionRequest = 0,
}: {
  websiteId: string;
  sessionId?: string;
  onSessionChange?: (sessionId: string) => void;
  createSessionRequest?: number;
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
  const previewClientIdRef = useRef<string | undefined>(undefined);
  const previewCapabilitiesRef = useRef<PreviewCapability[] | undefined>(undefined);
  const pendingConversationQueue = useRef<ConversationEvent[]>([]);
  const activeRunRef = useRef<string | undefined>(undefined);
  const conversationRafRef = useRef<number | undefined>(undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewOperationRef = useRef<Promise<unknown>>(Promise.resolve());
  const previewReadyRef = useRef<PreviewReadyWaiter | null>(null);
  const previewUrlPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const pendingSessionTitlesRef = useRef(new Map<string, { sessionId: string; title: string }>());

  activeRunRef.current = runId;

  const flushConversation = useCallback(() => {
    if (conversationRafRef.current !== undefined) {
      window.cancelAnimationFrame(conversationRafRef.current);
      conversationRafRef.current = undefined;
    }
    const queue = pendingConversationQueue.current;
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    dispatchConversation({ type: 'batch', actions: batch });
  }, []);

  const queueConversation = useCallback(
    (event: ConversationEvent, immediate = false) => {
      pendingConversationQueue.current.push(event);
      if (immediate) {
        flushConversation();
        return;
      }
      if (conversationRafRef.current === undefined)
        conversationRafRef.current = window.requestAnimationFrame(flushConversation);
    },
    [flushConversation],
  );

  const setRunIdState = useCallback((value: string | undefined) => {
    activeRunRef.current = value;
    setRunId(value);
  }, []);

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
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : t('unavailablePreview');
      setPreview({
        status: /not ready|stopped/i.test(message) ? 'stopped' : 'unavailable',
        message,
      });
      throw cause;
    });
    previewUrlPromiseRef.current = promise;
    return promise;
  }, [t, websiteId]);

  const refreshPreview = useCallback(() => {
    if (previewClient.current)
      void previewClient.current
        .refresh()
        .catch((cause) =>
          setError(cause instanceof Error ? cause.message : t('operationIncomplete')),
        );
    else setPreviewKey((current) => current + 1);
  }, [t]);

  const schedulePreviewRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(refreshPreview, 300);
  }, [refreshPreview]);

  const registerPreviewClient = useCallback(() => {
    if (!previewClientIdRef.current || !previewCapabilitiesRef.current) return;
    sendCommand({
      type: 'preview.client.register',
      websiteId,
      payload: {
        previewClientId: previewClientIdRef.current,
        capabilities: [...previewCapabilitiesRef.current],
      },
    });
  }, [sendCommand, websiteId]);

  const ensurePreviewReady = useCallback(async () => {
    setPreviewOpen(true);
    if (previewClient.current) return previewClient.current;
    if (preview.status !== 'ready' || !preview.url) await loadPreviewUrl();
    if (!previewReadyRef.current) {
      const waiter = createPreviewReadyWaiter();
      previewReadyRef.current = waiter;
      void waiter.promise.catch(() => {
        if (previewReadyRef.current === waiter) previewReadyRef.current = null;
      });
    }
    return previewReadyRef.current.promise;
  }, [loadPreviewUrl, preview.status, preview.url]);

  useEffect(() => {
    loadPreviewUrl()
      .then((url) => setPreview((current) => ({ ...current, url })))
      .catch(() => {});
    return () => {
      previewUrlPromiseRef.current = null;
    };
  }, [loadPreviewUrl]);

  useEffect(() => {
    const key = `cloudcrane.previewClientId.${websiteId}`;
    const stored = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, stored);
    previewClientIdRef.current = stored;
  }, [websiteId]);

  useEffect(() => {
    if (!previewOpen || preview.status !== 'ready' || !preview.url || !previewFrame.current) return;
    const client = new PreviewBridgeClient(previewFrame.current, preview.url, (capabilities) => {
      previewCapabilitiesRef.current = capabilities;
      setBridgeStatus('attached');
      registerPreviewClient();
      previewReadyRef.current?.resolve(client);
      previewReadyRef.current = null;
    });
    previewClient.current = client;
    return () => {
      client.dispose();
      if (previewClient.current === client) previewClient.current = null;
      const waiter = previewReadyRef.current;
      if (waiter) {
        window.clearTimeout(waiter.timer);
        waiter.reject(new Error('Preview Client was closed'));
        previewReadyRef.current = null;
      }
      setBridgeStatus('unavailable');
    };
  }, [preview.status, preview.url, previewOpen, registerPreviewClient]);

  // Load session list
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listAgentSessions(websiteId);
        if (cancelled) return;
        if (createSessionRequest > 0) {
          const created = await createAgentSession(websiteId);
          if (cancelled) return;
          const next = [...result.sessions, created.session];
          setSessions(next);
          setCurrentSessionId(created.session.id);
          onSessionChange?.(created.session.id);
        } else {
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
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('operationIncomplete'));
      }
    })();
    return () => {
      cancelled = true;
      socket.current?.close();
    };
  }, [createSessionRequest, websiteId, sessionId, onSessionChange, t]);

  // Listen to external sessionId changes
  useEffect(() => {
    if (sessionId !== currentSessionId) {
      flushConversation();
      queueConversation({ type: 'session.snapshot', payload: { messages: [] } }, true);
      setRunIdState(undefined);
      setError(undefined);
      setCurrentSessionId(sessionId);
    }
  }, [sessionId, currentSessionId, flushConversation, queueConversation, setRunIdState]);

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
    (payload: Extract<AgentEvent, { type: 'preview.request' }>['payload']) => {
      const operation = previewOperationRef.current.then(async () => {
        const client = await ensurePreviewReady();
        const response = await handlePreviewRequest(client, payload);
        if (response.ok) setPreview((current) => ({ ...current, path: response.observation.path }));
        return response;
      });
      previewOperationRef.current = operation.catch(() => undefined);
      return operation;
    },
    [ensurePreviewReady],
  );

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
        registerPreviewClient();
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

        if (projected.event.type === 'session.snapshot') {
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
                      code: previewErrorCode(cause),
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

        handleEvent(
          projected.event,
          projected.envelope,
          queueConversation,
          flushConversation,
          setRunIdState,
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
    registerPreviewClient,
    requestPreview,
    queueConversation,
    flushConversation,
    schedulePreviewRefresh,
    setRunIdState,
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

function previewErrorCode(
  cause: unknown,
):
  | 'CLIENT_UNAVAILABLE'
  | 'CLIENT_PREVIEW_TIMEOUT'
  | 'PREVIEW_CAPABILITY_UNAVAILABLE'
  | 'PREVIEW_PROTOCOL_ERROR'
  | 'INVALID_ARGUMENT' {
  if (cause instanceof PreviewBridgeClientError) return cause.code;
  if (cause instanceof Error && /timed out|not ready|closed/i.test(cause.message))
    return /timed out/i.test(cause.message) ? 'CLIENT_PREVIEW_TIMEOUT' : 'CLIENT_UNAVAILABLE';
  return 'PREVIEW_PROTOCOL_ERROR';
}

type PreviewReadyWaiter = {
  promise: Promise<PreviewBridgeClient>;
  resolve: (client: PreviewBridgeClient) => void;
  reject: (cause: Error) => void;
  timer: number;
};

function createPreviewReadyWaiter(): PreviewReadyWaiter {
  let resolvePromise!: (client: PreviewBridgeClient) => void;
  let rejectPromise!: (cause: Error) => void;
  const promise = new Promise<PreviewBridgeClient>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timer = window.setTimeout(() => rejectPromise(new Error('Preview Client timed out')), 8_000);
  return {
    promise,
    resolve: (client) => {
      window.clearTimeout(timer);
      resolvePromise(client);
    },
    reject: (cause) => {
      window.clearTimeout(timer);
      rejectPromise(cause);
    },
    timer,
  };
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
