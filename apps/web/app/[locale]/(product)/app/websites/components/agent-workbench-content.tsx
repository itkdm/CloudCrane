'use client';

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useTranslations } from 'next-intl';
import type { AgentEnvelope, AgentEvent, PreviewCapability } from '@cloudcrane/agent-protocol';
import { deriveSessionTitle } from '@cloudcrane/shared/session-title';
import {
  agentWebSocketUrl,
  command,
  listAgentSessions,
  parseAgentEvent,
  parseAgentMessage,
} from '@/lib/agent-client';
import { PreviewBridgeClient, PreviewBridgeClientError } from '@/lib/preview-bridge-client';
import { ChatPanel } from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/chat-panel';
import {
  conversationReducer,
  hasRunningManualMaintenance,
  initialConversationState,
  type ConversationEvent,
} from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/conversation-reducer';
import { PreviewPane } from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/preview-pane';
import { resolvePreviewSource } from '@/lib/preview-source';
import { authorizePreviewAccess, usePreviewAccess } from '@/lib/preview-access';
import type { PreviewViewportMode } from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/preview-viewport';
import {
  shouldClearErrorOnRunSettled,
  type PreviewState,
  type Session,
  type WorkbenchError,
} from '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/types';
import '@/app/[locale]/(workbench)/app/websites/[websiteId]/agent/components/agent-workbench/agent-workbench.css';
import './unified-agent-workbench.css';

type SessionChange =
  | string
  | {
      id: string;
      title?: string | null;
      createdAt?: string;
      updatedAt?: string;
    };

// Simplified workbench without SessionSidebar (managed by UnifiedSidebar)
export function AgentWorkbenchContent({
  websiteId,
  sessionId,
  onSessionChange,
  onSettingsOpen,
  initialPrompt,
  onInitialPromptConsumed,
  onPreviewOpenChange,
}: {
  websiteId: string;
  sessionId?: string;
  onSessionChange?: (change: SessionChange) => void;
  onSettingsOpen?: () => void;
  initialPrompt?: { id: string; websiteId: string; text: string };
  onInitialPromptConsumed?: (promptId: string) => void;
  onPreviewOpenChange?: (open: boolean) => void;
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
  const [error, setError] = useState<WorkbenchError | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [previewCurrentUrl, setPreviewCurrentUrl] = useState<string>();
  const [previewCurrentPath, setPreviewCurrentPath] = useState<string>();
  const [previewKey, setPreviewKey] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState<
    'unavailable' | 'attached' | 'detached' | 'error'
  >('unavailable');
  const [previewViewportMode, setPreviewViewportMode] = useState<PreviewViewportMode>('desktop');
  const [previewSplitRatio, setPreviewSplitRatio] = useState(0.45);
  const [isResizingPreview, setIsResizingPreview] = useState(false);

  const socket = useRef<WebSocket | null>(null);
  const previewFrame = useRef<HTMLIFrameElement | null>(null);
  const previewClient = useRef<PreviewBridgeClient | null>(null);
  const previewUrlRef = useRef<string | undefined>(undefined);
  const previewClientIdRef = useRef<string | undefined>(undefined);
  const previewCurrentUrlRef = useRef<string | undefined>(undefined);
  const previewWebsiteIdRef = useRef(websiteId);
  const previewStateWebsiteIdRef = useRef(websiteId);
  const previewCapabilitiesRef = useRef<PreviewCapability[] | undefined>(undefined);
  const pendingConversationQueue = useRef<ConversationEvent[]>([]);
  const activeRunRef = useRef<string | undefined>(undefined);
  const conversationRafRef = useRef<number | undefined>(undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewOperationRef = useRef<Promise<unknown>>(Promise.resolve());
  const previewReadyRef = useRef<PreviewReadyWaiter | null>(null);
  const pendingSessionTitlesRef = useRef(new Map<string, { sessionId: string; title: string }>());
  const pendingInteractionRequestsRef = useRef(new Map<string, string>());
  const initialPromptConsumedRef = useRef<string | undefined>(undefined);
  const [sessionSnapshotVersion, setSessionSnapshotVersion] = useState(0);
  const workbenchBodyRef = useRef<HTMLDivElement | null>(null);
  const onPreviewOpenChangeRef = useRef(onPreviewOpenChange);

  onPreviewOpenChangeRef.current = onPreviewOpenChange;
  previewWebsiteIdRef.current = websiteId;

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

  const respondInteraction = useCallback(
    (
      interactionId: string,
      response: { type: 'option'; optionIndex: number } | { type: 'custom'; value: string },
    ) => {
      const requestId = crypto.randomUUID();
      pendingInteractionRequestsRef.current.set(requestId, interactionId);
      sendCommand(
        {
          type: 'interaction.respond',
          websiteId,
          sessionId: currentSessionId,
          payload: { interactionId, response },
        },
        requestId,
      );
    },
    [currentSessionId, sendCommand, websiteId],
  );

  const cancelInteraction = useCallback(
    (interactionId: string) => {
      const requestId = crypto.randomUUID();
      pendingInteractionRequestsRef.current.set(requestId, interactionId);
      sendCommand(
        {
          type: 'interaction.cancel',
          websiteId,
          sessionId: currentSessionId,
          payload: { interactionId },
        },
        requestId,
      );
    },
    [currentSessionId, sendCommand, websiteId],
  );

  const handlePreviewAccess = useCallback((access: { url: string }) => {
    setPreview((current) => ({ ...current, status: 'ready', url: access.url }));
  }, []);
  const handlePreviewAccessError = useCallback(
    (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : t('unavailablePreview');
      setPreview({
        status: /not ready|stopped/i.test(message) ? 'stopped' : 'unavailable',
        message,
      });
    },
    [t],
  );
  const { ensureFreshPreviewAccess } = usePreviewAccess(websiteId, {
    enabled: previewOpen && bridgeStatus === 'attached',
    onAccess: handlePreviewAccess,
    onError: handlePreviewAccessError,
  });

  useEffect(() => {
    previewStateWebsiteIdRef.current = websiteId;
    previewCurrentUrlRef.current = undefined;
    previewUrlRef.current = undefined;
    setPreviewCurrentUrl(undefined);
    setPreviewCurrentPath(undefined);
    setPreview({ status: 'loading' });
    setBridgeStatus('unavailable');
    previewCapabilitiesRef.current = undefined;
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = undefined;
    }
    previewOperationRef.current = Promise.resolve();
    const waiter = previewReadyRef.current;
    if (waiter) {
      window.clearTimeout(waiter.timer);
      waiter.reject(new Error('Preview Website changed'));
      previewReadyRef.current = null;
    }
    setPreviewOpen(false);
  }, [websiteId]);

  const ensurePreviewAuthorizationFresh = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const access = await ensureFreshPreviewAccess({ force });
      await authorizePreviewAccess(access);
      return access;
    },
    [ensureFreshPreviewAccess],
  );

  const refreshPreview = useCallback(
    (source: 'user' | 'background' = 'user') => {
      if (source === 'background' && !previewOpen) return;
      void ensurePreviewAuthorizationFresh()
        .then(() => previewClient.current?.refresh())
        .catch((cause) => {
          if (source === 'user')
            setError(toWorkbenchError('preview-explicit', cause, t('operationIncomplete')));
        });
    },
    [ensurePreviewAuthorizationFresh, previewOpen, t],
  );

  const schedulePreviewRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => refreshPreview('background'), 300);
  }, [refreshPreview]);

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

  const ensurePreviewReady = useCallback(
    async ({ ensureAccess = true }: { ensureAccess?: boolean } = {}) => {
      if (ensureAccess || !previewClient.current) await ensurePreviewAuthorizationFresh();
      setPreviewOpen(true);
      if (previewClient.current) return previewClient.current;
      if (!previewReadyRef.current) {
        const waiter = createPreviewReadyWaiter();
        previewReadyRef.current = waiter;
        void waiter.promise.catch(() => {
          if (previewReadyRef.current === waiter) previewReadyRef.current = null;
        });
      }
      return previewReadyRef.current.promise;
    },
    [ensurePreviewAuthorizationFresh],
  );

  const togglePreview = useCallback(() => {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    void ensurePreviewAuthorizationFresh()
      .then(() => setPreviewOpen(true))
      .catch((cause) =>
        setError(toWorkbenchError('preview-explicit', cause, t('unavailablePreview'))),
      );
  }, [ensurePreviewAuthorizationFresh, previewOpen, t]);

  useEffect(() => {
    onPreviewOpenChangeRef.current?.(previewOpen);
  }, [previewOpen]);

  useEffect(() => {
    return () => onPreviewOpenChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if (!previewOpen) setIsResizingPreview(false);
  }, [previewOpen]);

  useEffect(() => {
    void ensureFreshPreviewAccess().catch(() => {});
  }, [ensureFreshPreviewAccess]);

  useEffect(() => {
    const key = `cloudcrane.previewClientId.${websiteId}`;
    const stored = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, stored);
    previewClientIdRef.current = stored;
  }, [websiteId]);

  useEffect(() => {
    previewUrlRef.current = preview.url;
  }, [preview.url]);

  useEffect(() => {
    if (
      !previewOpen ||
      preview.status !== 'ready' ||
      !previewUrlRef.current ||
      !previewFrame.current
    )
      return;
    const client = new PreviewBridgeClient(
      previewFrame.current,
      previewCurrentUrlRef.current ?? previewUrlRef.current,
      {
        onReady: (capabilities) => {
          previewCapabilitiesRef.current = capabilities;
          setBridgeStatus('attached');
          updatePreviewCapabilities();
          previewReadyRef.current?.resolve(client);
          previewReadyRef.current = null;
        },
        onLocationChange: ({ url, path }) => {
          previewCurrentUrlRef.current = url;
          setPreviewCurrentUrl(url);
          setPreviewCurrentPath(path);
          setPreview((current) => ({ ...current, path }));
        },
      },
    );
    previewClient.current = client;
    return () => {
      client.dispose();
      if (previewClient.current === client) previewClient.current = null;
      previewCapabilitiesRef.current = undefined;
      updatePreviewCapabilities();
      const waiter = previewReadyRef.current;
      if (waiter) {
        window.clearTimeout(waiter.timer);
        waiter.reject(new Error('Preview Client was closed'));
        previewReadyRef.current = null;
      }
      setBridgeStatus('unavailable');
    };
  }, [preview.status, previewOpen, updatePreviewCapabilities]);

  // Load only the explicitly selected session list. Session creation belongs to UnifiedApp.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listAgentSessions(websiteId);
        if (cancelled) return;
        setSessions(result.sessions);
      } catch (cause) {
        if (!cancelled) setError(toWorkbenchError('session', cause, t('operationIncomplete')));
      }
    })();
    return () => {
      cancelled = true;
      socket.current?.close();
    };
  }, [websiteId, t]);

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

  const submitPrompt = useCallback(
    (value: string) => {
      const text = value.trim();
      if (
        !text ||
        !currentSessionId ||
        activeRunRef.current ||
        hasRunningManualMaintenance(conversation)
      )
        return false;
      setError(undefined);
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
        if (!currentSession?.title?.trim())
          pendingSessionTitlesRef.current.set(requestId, {
            sessionId: currentSessionId,
            title: deriveSessionTitle(text),
          });
        socket.current.send(
          JSON.stringify({
            ...command({
              type: 'agent.prompt',
              websiteId,
              sessionId: currentSessionId,
              payload: { text, promptRequestId: requestId },
            }),
            requestId,
          }),
        );
      } else {
        pendingSessionTitlesRef.current.delete(requestId);
        queueConversation(
          { type: 'message.status', payload: { requestId, status: 'failed' } },
          true,
        );
        setError(toWorkbenchError('connection', undefined, t('connectionInterrupted')));
        return false;
      }
      setDraft('');
      return true;
    },
    [conversation, currentSessionId, queueConversation, sessions, t, websiteId],
  );

  useEffect(() => {
    if (
      !initialPrompt ||
      initialPrompt.websiteId !== websiteId ||
      !currentSessionId ||
      sessionSnapshotVersion === 0 ||
      initialPromptConsumedRef.current === initialPrompt.id
    )
      return;
    initialPromptConsumedRef.current = initialPrompt.id;
    if (submitPrompt(initialPrompt.text)) onInitialPromptConsumed?.(initialPrompt.id);
    else initialPromptConsumedRef.current = undefined;
  }, [
    currentSessionId,
    initialPrompt,
    onInitialPromptConsumed,
    sessionSnapshotVersion,
    submitPrompt,
    websiteId,
  ]);

  function submit() {
    submitPrompt(draft);
  }

  const stop = () => {
    if (currentSessionId)
      sendCommand({ type: 'agent.abort', websiteId, sessionId: currentSessionId, payload: {} });
  };

  const compactContext = useCallback(() => {
    if (!currentSessionId || activeRunRef.current || hasRunningManualMaintenance(conversation))
      return;
    sendCommand({
      type: 'session.compact',
      websiteId,
      sessionId: currentSessionId,
      payload: {},
    });
  }, [conversation, currentSessionId, sendCommand, websiteId]);

  const requestPreview = useCallback(
    (payload: Extract<AgentEvent, { type: 'preview.request' }>['payload']) => {
      const operation = previewOperationRef.current.then(async () => {
        let recovered = false;
        while (true) {
          try {
            const client = await ensurePreviewReady({
              ensureAccess: payload.operation !== 'observe',
            });
            const response = await handlePreviewRequest(client, payload);
            if (response.ok)
              setPreview((current) => ({ ...current, path: response.observation.path }));
            return response;
          } catch (cause) {
            if (recovered || !isPreviewTimeout(cause)) throw cause;
            recovered = true;
            await ensurePreviewAuthorizationFresh({ force: true });
            setPreviewKey((current) => current + 1);
          }
        }
      });
      previewOperationRef.current = operation.catch(() => undefined);
      return operation;
    },
    [ensurePreviewAuthorizationFresh, ensurePreviewReady],
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
        setError(toWorkbenchError('connection', undefined, t('connectionInterrupted')));
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
          setError((current) => (current?.source === 'session' ? undefined : current));
          const nextSession = projected.event.payload.session;
          setSessionSnapshotVersion((current) => current + 1);
          setSessions((current) => {
            const existing = current.some((session) => session.id === nextSession.id);
            return existing
              ? current.map((session) =>
                  session.id === nextSession.id ? { ...session, ...nextSession } : session,
                )
              : [nextSession, ...current];
          });
          onSessionChange?.({
            id: nextSession.id,
            title: nextSession.title,
            createdAt: nextSession.createdAt,
            updatedAt: nextSession.updatedAt,
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
            onSessionChange?.({
              id: pendingTitle.sessionId,
              title: pendingTitle.title,
            });
          }
        }

        if (projected.event.type === 'command.error') {
          const interactionId = pendingInteractionRequestsRef.current.get(
            projected.envelope.requestId,
          );
          if (interactionId) {
            pendingInteractionRequestsRef.current.delete(projected.envelope.requestId);
            queueConversation(
              {
                type: 'interaction.failed',
                payload: { interactionId, error: projected.event.payload.message },
              },
              true,
            );
          }
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

  const previewBelongsToWebsite = previewStateWebsiteIdRef.current === websiteId;
  const visiblePreview = previewBelongsToWebsite ? preview : { status: 'loading' as const };
  const visiblePreviewCurrentUrl = previewBelongsToWebsite ? previewCurrentUrl : undefined;
  const visiblePreviewCurrentPath = previewBelongsToWebsite ? previewCurrentPath : undefined;

  return (
    <main className="workbench">
      <div
        ref={workbenchBodyRef}
        className={`workbench-body no-session-sidebar ${previewOpen ? 'preview-open' : 'preview-closed'} ${isResizingPreview ? 'preview-resizing' : ''}`}
        style={
          previewOpen
            ? ({
                '--preview-chat-fr': `${previewSplitRatio}fr`,
                '--preview-pane-fr': `${1 - previewSplitRatio}fr`,
              } as CSSProperties)
            : undefined
        }
      >
        <ChatPanel
          turns={conversation.turns}
          draft={draft}
          running={Boolean(runId)}
          error={error}
          disabled={!currentSessionId}
          manualMaintenanceItems={conversation.manualMaintenanceItems}
          manualMaintenanceRunning={hasRunningManualMaintenance(conversation)}
          onCompact={compactContext}
          onDraftChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          onDismissError={() => setError(undefined)}
          onExample={setDraft}
          previewOpen={previewOpen}
          onPreviewToggle={togglePreview}
          onSettingsOpen={onSettingsOpen}
          onInteractionRespond={respondInteraction}
          onInteractionCancel={cancelInteraction}
        />
        {previewOpen ? (
          <WorkspaceResizeHandle
            containerRef={workbenchBodyRef}
            dragging={isResizingPreview}
            onDragStart={() => setIsResizingPreview(true)}
            onDragEnd={() => setIsResizingPreview(false)}
            onRatioChange={setPreviewSplitRatio}
          />
        ) : null}
        <PreviewPane
          preview={visiblePreview}
          open={previewOpen}
          previewKey={previewKey}
          frameRef={previewFrame}
          bridgeStatus={bridgeStatus}
          onClose={() => setPreviewOpen(false)}
          onRefresh={refreshPreview}
          onOpen={() => {
            const popup = window.open('about:blank', '_blank');
            if (!popup) {
              setError(toWorkbenchError('preview-explicit', undefined, t('operationIncomplete')));
              return;
            }
            popup.opener = null;
            void ensurePreviewAuthorizationFresh()
              .then((access) => {
                const url = resolvePreviewSource(access.url, visiblePreviewCurrentUrl);
                if (url) popup.location.replace(url);
              })
              .catch((cause) => {
                popup.close();
                setError(toWorkbenchError('preview-explicit', cause, t('operationIncomplete')));
              });
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

const PREVIEW_RESIZE_HANDLE_WIDTH = 8;
const MIN_CHAT_WIDTH = 380;
const MIN_PREVIEW_WIDTH = 460;

function WorkspaceResizeHandle({
  containerRef,
  dragging,
  onDragStart,
  onDragEnd,
  onRatioChange,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRatioChange: (ratio: number) => void;
}) {
  const updateRatio = (clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const availableWidth = container.clientWidth - PREVIEW_RESIZE_HANDLE_WIDTH;
    if (availableWidth <= 0) return;
    const minimumsFit = availableWidth >= MIN_CHAT_WIDTH + MIN_PREVIEW_WIDTH;
    const rawChatWidth = clientX - container.getBoundingClientRect().left;
    const chatWidth = minimumsFit
      ? Math.min(Math.max(rawChatWidth, MIN_CHAT_WIDTH), availableWidth - MIN_PREVIEW_WIDTH)
      : Math.max(0, Math.min(rawChatWidth, availableWidth));
    onRatioChange(Math.min(0.8, Math.max(0.2, chatWidth / availableWidth)));
  };

  return (
    <div
      className={`workspace-resize-handle ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-label="Resize chat and preview"
      aria-orientation="vertical"
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragStart();
        updateRatio(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateRatio(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
          onDragEnd();
        }
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
          onDragEnd();
        }
      }}
      onLostPointerCapture={() => {
        if (dragging) onDragEnd();
      }}
    />
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

function isPreviewTimeout(cause: unknown): boolean {
  return cause instanceof Error && /timed out|timeout/i.test(cause.message);
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
  const timer = window.setTimeout(
    () => rejectPromise(new Error('Preview Client timed out')),
    8_000,
  );
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
  setError: Dispatch<SetStateAction<WorkbenchError | undefined>>,
  schedulePreviewRefresh: () => void,
) {
  if (
    event.type === 'context.compaction.started' ||
    event.type === 'context.compaction.completed' ||
    event.type === 'context.compaction.failed' ||
    event.type === 'context.compaction.not_needed'
  ) {
    queueConversation({ type: event.type, payload: { runId: envelope.runId } }, true);
    return;
  }
  if (event.type === 'run.started') {
    setRunId(event.payload.runId);
    setError(undefined);
    queueConversation({ type: 'run.started', payload: { runId: event.payload.runId } }, true);
  }
  if (event.type === 'run.settled') {
    const settledRunId = event.payload.runId ?? envelope.runId;
    flushConversation();
    queueConversation(
      {
        type: 'run.settled',
        payload: {
          status: event.payload.status,
          ...(event.payload.error ? { error: event.payload.error } : {}),
          ...(event.payload.finalMessageId ? { finalMessageId: event.payload.finalMessageId } : {}),
          runId: settledRunId,
          traceId: event.payload.traceId ?? envelope.traceId,
        },
      },
      true,
    );
    setRunId(undefined);
    schedulePreviewRefresh();
    if (event.payload.status === 'COMPLETED')
      setError((current) =>
        shouldClearErrorOnRunSettled(current, settledRunId) ? undefined : current,
      );
  }
  if (event.type === 'command.ack')
    queueConversation(
      { type: 'message.status', payload: { requestId: envelope.requestId, status: 'accepted' } },
      true,
    );
  if (event.type === 'command.error') {
    setError(
      toWorkbenchError('command', event.payload.message, event.payload.message, {
        code: event.payload.code,
        requestId: envelope.requestId,
        runId: envelope.runId,
      }),
    );
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
          contextMaintenance: event.payload.contextMaintenance,
          pendingInteractions: event.payload.pendingInteractions,
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
  if (event.type === 'interaction.requested')
    queueConversation({ type: 'interaction.requested', payload: event.payload }, true);
}

function toWorkbenchError(
  source: WorkbenchError['source'],
  cause: unknown,
  fallback: string,
  metadata: Pick<WorkbenchError, 'code' | 'requestId' | 'runId'> = {},
): WorkbenchError {
  return {
    source,
    message: cause instanceof Error ? cause.message : fallback,
    ...metadata,
  };
}
