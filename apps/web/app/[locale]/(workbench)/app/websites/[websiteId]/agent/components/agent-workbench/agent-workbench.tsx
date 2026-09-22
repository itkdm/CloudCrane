'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  AgentEnvelope,
  AgentEvent,
  AttachmentRef,
  PreviewCapability,
} from '@cloudcrane/agent-protocol';
import { deriveSessionTitle } from '@cloudcrane/shared/session-title';
import {
  agentWebSocketUrl,
  command,
  createAgentSession,
  getPreviewUrl,
  listAgentSessions,
  uploadAttachment,
  parseAgentEvent,
  parseAgentMessage,
} from '@/lib/agent-client';
import { PreviewBridgeClient, PreviewBridgeClientError } from '@/lib/preview-bridge-client';
import { ChatPanel } from './chat-panel';
import {
  conversationReducer,
  initialConversationState,
  type ConversationEvent,
} from './conversation-reducer';
import { PreviewPane } from './preview-pane';
import { resolvePreviewSource } from '@/lib/preview-source';
import type { PreviewViewportMode } from './preview-viewport';
import { SessionSidebar } from './session-sidebar';
import type { PreviewState, Session } from './types';
import './agent-workbench.css';

export function AgentWorkbench({ websiteId }: { websiteId: string }) {
  const t = useTranslations('workbench');
  const socket = useRef<WebSocket | null>(null);
  const previewFrame = useRef<HTMLIFrameElement | null>(null);
  const previewBridge = useRef<PreviewBridgeClient | null>(null);
  const previewClientIdRef = useRef<string | undefined>(undefined);
  const previewCurrentUrlRef = useRef<string | undefined>(undefined);
  const previewWebsiteIdRef = useRef(websiteId);
  const previewStateWebsiteIdRef = useRef(websiteId);
  const previewCapabilitiesRef = useRef<PreviewCapability[] | undefined>(undefined);
  const activeRunRef = useRef<string | undefined>(undefined);
  const conversationRafRef = useRef<number | undefined>(undefined);
  const pendingConversationActionsRef = useRef<ConversationEvent[]>([]);
  const previewReadyRef = useRef<PreviewReadyWaiter | null>(null);
  const previewUrlPromiseRef = useRef<Promise<string> | null>(null);
  const previewOperationRef = useRef<Promise<unknown>>(Promise.resolve());
  const previewDirtyRef = useRef(false);
  const previewDirtyGenerationRef = useRef(0);
  const previewEpochRef = useRef(0);
  const previewRefreshRunRef = useRef<string | undefined>(undefined);
  const previewRefreshGenerationRef = useRef<number | undefined>(undefined);
  const previewSettledRefreshRunsRef = useRef(new Set<string>());
  const pendingSessionTitlesRef = useRef(new Map<string, { sessionId: string; title: string }>());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [conversation, dispatchConversation] = useReducer(
    conversationReducer,
    initialConversationState,
  );
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploadingAttachmentNames, setUploadingAttachmentNames] = useState<string[]>([]);
  const [runId, setRunIdState] = useState<string>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [previewCurrentUrl, setPreviewCurrentUrl] = useState<string>();
  const [previewCurrentPath, setPreviewCurrentPath] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewKey = 0;
  const [bridgeStatus, setBridgeStatus] = useState('waiting');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHydrated, setSidebarHydrated] = useState(false);
  const [previewViewportMode, setPreviewViewportMode] = useState<PreviewViewportMode>('desktop');

  previewWebsiteIdRef.current = websiteId;

  const flushConversation = useCallback(() => {
    if (conversationRafRef.current !== undefined) {
      window.cancelAnimationFrame(conversationRafRef.current);
      conversationRafRef.current = undefined;
    }
    const actions = pendingConversationActionsRef.current;
    if (actions.length === 0) return;
    pendingConversationActionsRef.current = [];
    dispatchConversation({ type: 'batch', actions });
  }, []);

  const queueConversation = useCallback(
    (action: ConversationEvent, immediate = false) => {
      pendingConversationActionsRef.current.push(action);
      if (immediate) {
        flushConversation();
        return;
      }
      if (conversationRafRef.current === undefined) {
        conversationRafRef.current = window.requestAnimationFrame(flushConversation);
      }
    },
    [flushConversation],
  );

  const setRunId = useCallback((value: string | undefined) => {
    activeRunRef.current = value;
    setRunIdState(value);
  }, []);

  const refreshPreview = useCallback(
    async (
      source: 'user' | 'background' = 'user',
      generation = previewDirtyGenerationRef.current,
      runId?: string,
    ) => {
      const epoch = previewEpochRef.current;
      const operation = previewOperationRef.current.then(async () => {
        if (previewEpochRef.current !== epoch) return;
        if (
          source === 'background' &&
          (!previewDirtyRef.current ||
            previewRefreshGenerationRef.current === generation ||
            (runId &&
              previewRefreshRunRef.current === runId &&
              previewRefreshGenerationRef.current === generation))
        )
          return;
        const bridge = previewBridge.current;
        if (!bridge) return;
        await bridge.refresh();
        if (previewEpochRef.current !== epoch) return;
        if (source === 'background') previewRefreshGenerationRef.current = generation;
        if (source === 'background' && previewDirtyGenerationRef.current === generation) {
          previewRefreshRunRef.current = runId;
          previewRefreshGenerationRef.current = generation;
        }
        if (previewDirtyGenerationRef.current === generation) previewDirtyRef.current = false;
      });
      previewOperationRef.current = operation.catch(() => undefined);
      try {
        await operation;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('operationIncomplete'));
      }
    },
    [t],
  );

  const markPreviewDirty = useCallback(() => {
    previewDirtyRef.current = true;
    previewDirtyGenerationRef.current += 1;
  }, []);

  const schedulePreviewRefresh = useCallback(
    (runId?: string) => {
      if (!previewDirtyRef.current) return;
      if (runId && activeRunRef.current && activeRunRef.current !== runId) return;
      if (runId && previewSettledRefreshRunsRef.current.has(runId)) return;
      const currentGeneration = previewDirtyGenerationRef.current;
      if (
        runId &&
        previewRefreshRunRef.current === runId &&
        previewRefreshGenerationRef.current === currentGeneration
      )
        return;
      if (previewRefreshGenerationRef.current === currentGeneration) return;
      if (runId) {
        previewSettledRefreshRunsRef.current.add(runId);
        if (previewSettledRefreshRunsRef.current.size > 32) {
          const oldest = previewSettledRefreshRunsRef.current.values().next().value;
          if (oldest) previewSettledRefreshRunsRef.current.delete(oldest);
        }
      }
      void refreshPreview('background', currentGeneration, runId);
    },
    [refreshPreview],
  );

  const sendCommand = useCallback((input: Parameters<typeof command>[0], requestId?: string) => {
    const next = command(input);
    if (requestId) next.requestId = requestId;
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(next));
  }, []);

  const registerPreviewClient = useCallback(() => {
    if (!previewClientIdRef.current) return;
    sendCommand({
      type: 'preview.client.register',
      websiteId,
      payload: {
        previewClientId: previewClientIdRef.current,
      },
    });
  }, [sendCommand, websiteId]);

  const updatePreviewCapabilities = useCallback(() => {
    if (!previewClientIdRef.current) return;
    sendCommand({
      type: 'preview.client.capabilities',
      websiteId,
      payload: {
        previewClientId: previewClientIdRef.current,
        ...(previewCapabilitiesRef.current
          ? { capabilities: [...previewCapabilitiesRef.current] }
          : {}),
      },
    });
  }, [sendCommand, websiteId]);

  const loadPreviewUrl = useCallback(() => {
    if (!previewUrlPromiseRef.current) {
      previewUrlPromiseRef.current = getPreviewUrl(websiteId)
        .then(({ url }) => {
          if (previewWebsiteIdRef.current !== websiteId) return url;
          setPreview({ status: 'ready', url });
          return url;
        })
        .catch((cause) => {
          if (previewWebsiteIdRef.current !== websiteId) throw cause;
          const message = cause instanceof Error ? cause.message : t('unavailablePreview');
          setPreview({
            status: /not ready|stopped/i.test(message) ? 'stopped' : 'unavailable',
            message,
          });
          throw cause;
        });
    }
    return previewUrlPromiseRef.current;
  }, [websiteId]);

  useEffect(() => {
    previewEpochRef.current += 1;
    previewStateWebsiteIdRef.current = websiteId;
    previewCurrentUrlRef.current = undefined;
    setPreviewCurrentUrl(undefined);
    setPreviewCurrentPath(undefined);
    setPreview({ status: 'loading' });
    setBridgeStatus('waiting');
    previewCapabilitiesRef.current = undefined;
    previewUrlPromiseRef.current = null;
    previewDirtyRef.current = false;
    previewDirtyGenerationRef.current += 1;
    previewRefreshRunRef.current = undefined;
    previewRefreshGenerationRef.current = undefined;
    previewOperationRef.current = Promise.resolve();
    const waiter = previewReadyRef.current;
    if (waiter) {
      window.clearTimeout(waiter.timer);
      waiter.reject(new Error('Preview Website changed'));
      previewReadyRef.current = null;
    }
    setPreviewOpen(false);
  }, [websiteId]);

  useEffect(
    () => () => {
      previewEpochRef.current += 1;
    },
    [],
  );

  const ensurePreviewReady = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!isCurrent()) throw new Error('Preview request expired');
      setPreviewOpen(true);
      if (previewBridge.current) return previewBridge.current;
      if (preview.status !== 'ready' || !preview.url) await loadPreviewUrl();
      if (!isCurrent()) throw new Error('Preview request expired');
      if (!previewReadyRef.current) {
        const waiter = createPreviewReadyWaiter();
        previewReadyRef.current = waiter;
        void waiter.promise.catch(() => {
          if (previewReadyRef.current === waiter) previewReadyRef.current = null;
        });
      }
      return previewReadyRef.current.promise;
    },
    [loadPreviewUrl, preview.status, preview.url],
  );

  const requestPreview = useCallback(
    (request: Extract<AgentEvent, { type: 'preview.request' }>['payload']) => {
      const epoch = previewEpochRef.current;
      const operation = previewOperationRef.current.then(async () => {
        if (previewEpochRef.current !== epoch) throw new Error('Preview request expired');
        const client = await ensurePreviewReady(() => previewEpochRef.current === epoch);
        if (previewEpochRef.current !== epoch) throw new Error('Preview request expired');
        const payload =
          request.operation === 'refresh' &&
          previewRefreshGenerationRef.current === previewDirtyGenerationRef.current
            ? { ok: true as const, observation: await client.observe() }
            : await handlePreviewRequest(client, request);
        if (previewEpochRef.current !== epoch) throw new Error('Preview request expired');
        if (payload.ok) setPreview((current) => ({ ...current, path: payload.observation.path }));
        return payload;
      });
      previewOperationRef.current = operation.catch(() => undefined);
      return operation;
    },
    [ensurePreviewReady],
  );

  useEffect(() => {
    const key = `cloudcrane.previewClientId.${websiteId}`;
    const stored = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, stored);
    previewClientIdRef.current = stored;
  }, [websiteId]);

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem('cloudcrane.sidebar.collapsed') === 'true');
    setSidebarHydrated(true);
  }, []);

  useEffect(() => {
    if (!sidebarHydrated) return;
    localStorage.setItem('cloudcrane.sidebar.collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed, sidebarHydrated]);

  useEffect(() => {
    return () => {
      if (conversationRafRef.current !== undefined)
        window.cancelAnimationFrame(conversationRafRef.current);
      pendingConversationActionsRef.current = [];
    };
  }, []);

  useEffect(() => {
    previewUrlPromiseRef.current = null;
    setPreview({ status: 'loading' });
    void loadPreviewUrl().catch(() => undefined);
    return () => {
      previewUrlPromiseRef.current = null;
    };
  }, [loadPreviewUrl]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listAgentSessions(websiteId);
        if (cancelled) return;
        let next = result.sessions;
        if (next.length === 0) next = [(await createAgentSession(websiteId)).session];
        setSessions(next);
        setSessionId(next[0]?.id);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('operationIncomplete'));
      }
    })();
    return () => {
      cancelled = true;
      socket.current?.close();
    };
  }, [websiteId]);

  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(agentWebSocketUrl());
      socket.current = ws;
      ws.onopen = () => {
        if (disposed || socket.current !== ws) return;
        sendCommand({ type: 'session.attach', websiteId, payload: { sessionId } });
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
        if (projected.envelope.sessionId && projected.envelope.sessionId !== sessionId) return;
        if (
          projected.envelope.runId &&
          activeRunRef.current &&
          projected.envelope.runId !== activeRunRef.current &&
          projected.event.type !== 'run.started'
        )
          return;
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
        if (projected.event.type === 'run.started' && sessionId) {
          setSessions((current) =>
            current.map((session) =>
              session.id === sessionId
                ? { ...session, lastActiveAt: new Date().toISOString() }
                : session,
            ),
          );
        }
        if (projected.event.type === 'preview.request') {
          const previewEpoch = previewEpochRef.current;
          const previewRefreshGeneration = previewDirtyGenerationRef.current;
          const isExplicitRefresh =
            'operation' in projected.event.payload &&
            projected.event.payload.operation === 'refresh';
          void requestPreview(projected.event.payload)
            .then((payload) => {
              if (previewEpochRef.current !== previewEpoch) return;
              if (isExplicitRefresh && payload.ok) {
                previewRefreshRunRef.current = projected.envelope.runId;
                previewRefreshGenerationRef.current = previewRefreshGeneration;
                if (previewDirtyGenerationRef.current === previewRefreshGeneration)
                  previewDirtyRef.current = false;
              }
              sendCommand(
                { type: 'preview.response', websiteId, sessionId, payload },
                projected.envelope.requestId,
              );
            })
            .catch((cause) => {
              if (previewEpochRef.current !== previewEpoch) return;
              if (isExplicitRefresh && previewRefreshRunRef.current === projected.envelope.runId)
                previewRefreshRunRef.current = undefined;
              if (isExplicitRefresh && previewRefreshRunRef.current === undefined)
                previewRefreshGenerationRef.current = undefined;
              sendCommand(
                {
                  type: 'preview.response',
                  websiteId,
                  sessionId,
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
        if (projected.event.type === 'command.error')
          pendingSessionTitlesRef.current.delete(projected.envelope.requestId);
        handleEvent(
          projected.event,
          projected.envelope,
          queueConversation,
          flushConversation,
          setRunId,
          setError,
          schedulePreviewRefresh,
          markPreviewDirty,
        );
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      const current = socket.current;
      current?.close();
      if (socket.current === current) socket.current = null;
    };
  }, [
    flushConversation,
    queueConversation,
    registerPreviewClient,
    requestPreview,
    schedulePreviewRefresh,
    markPreviewDirty,
    sendCommand,
    sessionId,
    setRunId,
    websiteId,
  ]);

  useEffect(() => {
    if (!previewOpen || preview.status !== 'ready' || !preview.url || !previewFrame.current) return;
    const epoch = previewEpochRef.current;
    const client = new PreviewBridgeClient(
      previewFrame.current,
      previewCurrentUrlRef.current ?? preview.url,
      {
        onReady: (capabilities) => {
          if (previewEpochRef.current !== epoch || previewBridge.current !== client) return;
          previewCapabilitiesRef.current = capabilities;
          setBridgeStatus('connected');
          updatePreviewCapabilities();
          previewReadyRef.current?.resolve(client);
          previewReadyRef.current = null;
        },
        onLocationChange: ({ url, path }) => {
          if (previewEpochRef.current !== epoch || previewBridge.current !== client) return;
          previewCurrentUrlRef.current = url;
          setPreviewCurrentUrl(url);
          setPreviewCurrentPath(path);
          setPreview((current) => ({ ...current, path }));
        },
      },
    );
    previewBridge.current = client;
    return () => {
      client.dispose();
      if (previewBridge.current === client) previewBridge.current = null;
      previewCapabilitiesRef.current = undefined;
      updatePreviewCapabilities();
      const waiter = previewReadyRef.current;
      if (waiter) {
        window.clearTimeout(waiter.timer);
        waiter.reject(new Error('Preview Client was closed'));
        previewReadyRef.current = null;
      }
      setBridgeStatus('waiting');
    };
  }, [preview.status, preview.url, previewOpen, previewKey, updatePreviewCapabilities]);

  function submit() {
    const text = draft.trim();
    if (!text || !sessionId || activeRunRef.current) return;
    const requestId = crypto.randomUUID();
    queueConversation(
      {
        type: 'user.added',
        payload: {
          message: {
            id: requestId,
            requestId,
            role: 'user',
            text,
            attachments,
            timestamp: Date.now(),
            status: 'pending',
          },
        },
      },
      true,
    );
    if (socket.current?.readyState === WebSocket.OPEN) {
      const currentSession = sessions.find((session) => session.id === sessionId);
      if (!currentSession?.title?.trim())
        pendingSessionTitlesRef.current.set(requestId, {
          sessionId,
          title: deriveSessionTitle(text),
        });
      socket.current.send(
        JSON.stringify({
          ...command({
            type: 'agent.prompt',
            websiteId,
            sessionId,
            payload: { text, promptRequestId: requestId, attachments },
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
    setAttachments([]);
  }

  function selectAttachments(files: File[]) {
    if (!sessionId) return;
    const selectedFiles = files.slice(0, 8 - attachments.length);
    if (selectedFiles.length === 0) return;
    setUploadingAttachmentNames(selectedFiles.map((file) => file.name));
    void Promise.allSettled(
      selectedFiles.map((file) => uploadAttachment(websiteId, sessionId, file)),
    )
      .then((results) => {
        const uploaded = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        if (uploaded.length) setAttachments((current) => [...current, ...uploaded]);
        if (results.some((result) => result.status === 'rejected'))
          setError(t('operationIncomplete'));
      })
      .finally(() => {
        setUploadingAttachmentNames([]);
      });
  }

  function createSession() {
    void createAgentSession(websiteId)
      .then(({ session }) => {
        setSessions((current) => [session, ...current]);
        setSessionId(session.id);
        queueConversation({ type: 'session.snapshot', payload: { messages: [] } }, true);
        setRunId(undefined);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : t('operationIncomplete')),
      );
  }

  function selectSession(nextSessionId: string) {
    if (nextSessionId === sessionId) return;
    flushConversation();
    queueConversation({ type: 'session.snapshot', payload: { messages: [] } }, true);
    setRunId(undefined);
    setError(undefined);
    setSessionId(nextSessionId);
  }

  const stop = () => {
    if (sessionId) sendCommand({ type: 'agent.abort', websiteId, sessionId, payload: {} });
  };

  const previewBelongsToWebsite = previewStateWebsiteIdRef.current === websiteId;
  const visiblePreview = previewBelongsToWebsite ? preview : { status: 'loading' as const };
  const visiblePreviewCurrentUrl = previewBelongsToWebsite ? previewCurrentUrl : undefined;
  const visiblePreviewCurrentPath = previewBelongsToWebsite ? previewCurrentPath : undefined;

  return (
    <main className="workbench">
      <div
        className={`workbench-body ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${previewOpen ? 'preview-open' : 'preview-closed'}`}
      >
        <SessionSidebar
          sessions={sessions}
          sessionId={sessionId}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((current) => !current)}
          onSelect={selectSession}
          onCreate={createSession}
        />
        <ChatPanel
          turns={conversation.turns}
          draft={draft}
          running={Boolean(runId)}
          error={error}
          disabled={!sessionId}
          onDraftChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          onDismissError={() => setError(undefined)}
          onExample={setDraft}
          attachments={attachments}
          uploadingAttachmentNames={uploadingAttachmentNames}
          onAttachmentSelect={selectAttachments}
          onAttachmentRemove={(id) =>
            setAttachments((current) => current.filter((item) => item.id !== id))
          }
        />
        <PreviewPane
          preview={visiblePreview}
          open={previewOpen}
          previewKey={previewKey}
          frameRef={previewFrame}
          bridgeStatus={bridgeStatus}
          onClose={() => setPreviewOpen(false)}
          onRefresh={() => void refreshPreview('user')}
          onOpen={() => {
            const url = resolvePreviewSource(visiblePreview.url, visiblePreviewCurrentUrl);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          }}
          previewViewportMode={previewViewportMode}
          onPreviewViewportModeChange={setPreviewViewportMode}
          currentPath={visiblePreviewCurrentPath}
          currentUrl={visiblePreviewCurrentUrl}
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
  if (cause instanceof Error && /timed out|not ready|closed/i.test(cause.message)) {
    return /timed out/i.test(cause.message) ? 'CLIENT_PREVIEW_TIMEOUT' : 'CLIENT_UNAVAILABLE';
  }
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
  const timer = window.setTimeout(() => {
    rejectPromise(new Error('Preview Client timed out'));
  }, 8_000);
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
  schedulePreviewRefresh: (runId?: string) => void,
  markPreviewDirty: () => void,
) {
  if (event.type === 'run.started') {
    setRunId(event.payload.runId);
    queueConversation({ type: 'run.started', payload: { runId: event.payload.runId } }, true);
  }
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
    schedulePreviewRefresh(event.payload.runId ?? envelope.runId);
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
  if (event.type === 'turn.started') {
    // Protocol turn markers belong to one product turn; the reducer keeps the
    // product execution process expanded while the run is active.
    queueConversation({ type: 'turn.started', payload: event.payload }, true);
  }
  if (event.type === 'turn.completed') {
    queueConversation({ type: 'turn.completed', payload: event.payload }, true);
  }
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
    if (['edit', 'write', 'bash'].includes(event.payload.toolName)) markPreviewDirty();
  }
}
