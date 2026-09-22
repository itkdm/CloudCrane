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
  uploadReference,
  uploadAttachment,
  parseAgentEvent,
  parseAgentMessage,
  listModelProfiles,
  type ModelProfile,
} from '@/lib/agent-client';
import {
  PREVIEW_READY_TIMEOUT_MS,
  PreviewBridgeClient,
  PreviewBridgeClientError,
} from '@/lib/preview-bridge-client';
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
  shouldClearErrorOnRecovery,
  type PreviewState,
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
      lastActiveAt?: string | null;
      pinnedAt?: string | null;
      clonedFromSessionId?: string | null;
    };

// Simplified workbench without SessionSidebar (managed by UnifiedSidebar)
export function AgentWorkbenchContent({
  websiteId,
  sessionId,
  sessionMetadata,
  onSessionChange,
  onSettingsOpen,
  initialPrompt,
  onInitialPromptConsumed,
  onPreviewOpenChange,
}: {
  websiteId: string;
  sessionId?: string;
  sessionMetadata: Array<{ id: string; title?: string | null }>;
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
  const [runId, setRunId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const [selectedModelProfileId, setSelectedModelProfileId] = useState<string>();
  const [uploadingAttachmentNames, setUploadingAttachmentNames] = useState<string[]>([]);
  const [error, setError] = useState<WorkbenchError | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [previewCurrentUrl, setPreviewCurrentUrl] = useState<string>();
  const [previewCurrentPath, setPreviewCurrentPath] = useState<string>();
  const [previewKey, setPreviewKey] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState<'waiting' | 'attached' | 'detached' | 'error'>(
    'waiting',
  );
  const [previewViewportMode, setPreviewViewportMode] = useState<PreviewViewportMode>('desktop');
  const [previewSplitRatio, setPreviewSplitRatio] = useState(0.45);
  const [isResizingPreview, setIsResizingPreview] = useState(false);

  useEffect(() => {
    void listModelProfiles()
      .then(({ profiles }) => {
        setModelProfiles(profiles);
        const storageKey = `cloudcrane:selected-model-profile:${websiteId}`;
        const storedProfileId = window.localStorage.getItem(storageKey);
        const selectedProfileId =
          storedProfileId && profiles.some((profile) => profile.id === storedProfileId)
            ? storedProfileId
            : (profiles.find((profile) => profile.isDefault)?.id ?? profiles[0]?.id);
        setSelectedModelProfileId(selectedProfileId);
        if (selectedProfileId) window.localStorage.setItem(storageKey, selectedProfileId);
      })
      .catch(() => undefined);
  }, [websiteId]);

  function selectModelProfile(profileId: string) {
    setSelectedModelProfileId(profileId);
    window.localStorage.setItem(`cloudcrane:selected-model-profile:${websiteId}`, profileId);
  }

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
  const previewDirtyRef = useRef(false);
  const previewDirtyGenerationRef = useRef(0);
  const previewEpochRef = useRef(0);
  const previewRefreshRunRef = useRef<string | undefined>(undefined);
  const previewRefreshGenerationRef = useRef<number | undefined>(undefined);
  const previewSettledRefreshRunsRef = useRef(new Set<string>());
  const previewOperationRef = useRef<Promise<unknown>>(Promise.resolve());
  const previewReadyRef = useRef<PreviewReadyWaiter | null>(null);
  const pendingSessionTitlesRef = useRef(new Map<string, { sessionId: string; title: string }>());
  const pendingInteractionRequestsRef = useRef(new Map<string, string>());
  const pendingPromptRequestIdRef = useRef<string | undefined>(undefined);
  const pendingPromptAckedRef = useRef(false);
  const pendingCompactionRequestIdRef = useRef<string | undefined>(undefined);
  const compactionStartedRef = useRef(false);
  const compactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialPromptConsumedRef = useRef<string | undefined>(undefined);
  const [sessionSnapshotVersion, setSessionSnapshotVersion] = useState(0);
  const [manualMaintenancePending, setManualMaintenancePending] = useState(false);
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

  const clearManualMaintenancePending = useCallback(() => {
    if (compactionTimeoutRef.current) {
      clearTimeout(compactionTimeoutRef.current);
      compactionTimeoutRef.current = undefined;
    }
    pendingCompactionRequestIdRef.current = undefined;
    compactionStartedRef.current = false;
    setManualMaintenancePending(false);
  }, []);

  const failPendingPrompt = useCallback(
    (message: string, allowRecovery: boolean) => {
      const requestId = pendingPromptRequestIdRef.current;
      if (!requestId) return;
      if (allowRecovery && pendingPromptAckedRef.current) return;
      pendingPromptRequestIdRef.current = undefined;
      pendingPromptAckedRef.current = false;
      pendingSessionTitlesRef.current.delete(requestId);
      queueConversation({ type: 'message.status', payload: { requestId, status: 'failed' } }, true);
      setError(toWorkbenchError('connection', undefined, message));
    },
    [queueConversation],
  );

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

  const uploadReferenceFile = useCallback(
    async (interactionId: string, file: File) => {
      if (!currentSessionId) throw new Error('No active session');
      await uploadReference(websiteId, currentSessionId, interactionId, file);
    },
    [currentSessionId, websiteId],
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
    previewEpochRef.current += 1;
    previewStateWebsiteIdRef.current = websiteId;
    previewCurrentUrlRef.current = undefined;
    previewUrlRef.current = undefined;
    setPreviewCurrentUrl(undefined);
    setPreviewCurrentPath(undefined);
    setPreview({ status: 'loading' });
    setBridgeStatus('waiting');
    previewCapabilitiesRef.current = undefined;
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

  const ensurePreviewAuthorizationFresh = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const access = await ensureFreshPreviewAccess({ force });
      await authorizePreviewAccess(access);
      return access;
    },
    [ensureFreshPreviewAccess],
  );

  const refreshPreview = useCallback(
    async (
      source: 'user' | 'background' = 'user',
      generation = previewDirtyGenerationRef.current,
      runId?: string,
    ) => {
      if (source === 'background' && !previewOpen) return;
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
        await ensurePreviewAuthorizationFresh();
        if (previewEpochRef.current !== epoch) return;
        const client = previewClient.current;
        if (!client) return;
        await client.refresh();
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
        if (source === 'user')
          setError(toWorkbenchError('preview-explicit', cause, t('operationIncomplete')));
      }
    },
    [ensurePreviewAuthorizationFresh, previewOpen, t],
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
    async ({
      ensureAccess = true,
      isCurrent = () => true,
    }: { ensureAccess?: boolean; isCurrent?: () => boolean } = {}) => {
      if (ensureAccess || !previewClient.current) await ensurePreviewAuthorizationFresh();
      if (!isCurrent()) throw new Error('Preview request expired');
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
    const epoch = previewEpochRef.current;
    const client = new PreviewBridgeClient(
      previewFrame.current,
      previewCurrentUrlRef.current ?? previewUrlRef.current,
      {
        onReady: (capabilities) => {
          if (previewEpochRef.current !== epoch || previewClient.current !== client) return;
          previewCapabilitiesRef.current = capabilities;
          setBridgeStatus('attached');
          updatePreviewCapabilities();
          previewReadyRef.current?.resolve(client);
          previewReadyRef.current = null;
        },
        onLocationChange: ({ url, path }) => {
          if (previewEpochRef.current !== epoch || previewClient.current !== client) return;
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
      setBridgeStatus('waiting');
    };
  }, [preview.status, preview.url, previewOpen, previewKey, updatePreviewCapabilities]);

  // Listen to external sessionId changes
  useEffect(() => {
    if (sessionId !== currentSessionId) {
      flushConversation();
      queueConversation({ type: 'session.snapshot', payload: { messages: [] } }, true);
      setSessionSnapshotVersion(0);
      setRunIdState(undefined);
      setError(undefined);
      setCurrentSessionId(sessionId);
    }
  }, [sessionId, currentSessionId, flushConversation, queueConversation, setRunIdState]);

  const submitPrompt = useCallback(
    (value: string) => {
      const text = value.trim();
      const blocked = {
        empty: !text,
        missingSession: !currentSessionId,
        activeRun: Boolean(activeRunRef.current),
        promptPending: Boolean(pendingPromptRequestIdRef.current),
        maintenance: hasRunningManualMaintenance(conversation),
        maintenancePending: Boolean(pendingCompactionRequestIdRef.current),
      };
      if (Object.values(blocked).some(Boolean)) {
        return false;
      }
      if (!currentSessionId) return false;
      const sessionId = currentSessionId;
      setError(undefined);
      const requestId = crypto.randomUUID();
      pendingPromptRequestIdRef.current = requestId;
      pendingPromptAckedRef.current = false;
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
              status: 'pending',
            },
          },
        },
        true,
      );
      if (socket.current?.readyState === WebSocket.OPEN) {
        const currentSession = sessionMetadata.find((session) => session.id === sessionId);
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
              payload: {
                text,
                promptRequestId: requestId,
                attachments,
                modelProfileId: selectedModelProfileId,
              },
            }),
            requestId,
          }),
        );
      } else {
        pendingPromptRequestIdRef.current = undefined;
        pendingSessionTitlesRef.current.delete(requestId);
        queueConversation(
          { type: 'message.status', payload: { requestId, status: 'failed' } },
          true,
        );
        setError(toWorkbenchError('connection', undefined, t('connectionInterrupted')));
        return false;
      }
      setDraft('');
      setAttachments([]);
      return true;
    },
    [attachments, conversation, currentSessionId, queueConversation, sessionMetadata, t, websiteId],
  );

  function selectAttachments(files: File[]) {
    if (!currentSessionId) return;
    const selectedFiles = files.slice(0, 8 - attachments.length);
    if (selectedFiles.length === 0) return;
    setAttachmentsUploading(true);
    setUploadingAttachmentNames(selectedFiles.map((file) => file.name));
    const uploads = selectedFiles.map((file) =>
      uploadAttachment(websiteId, currentSessionId, file),
    );
    void Promise.allSettled(uploads)
      .then((results) => {
        const uploaded = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        if (uploaded.length) setAttachments((current) => [...current, ...uploaded]);
        if (results.some((result) => result.status === 'rejected'))
          setError(toWorkbenchError('command', undefined, t('operationIncomplete')));
      })
      .finally(() => {
        setUploadingAttachmentNames([]);
        setAttachmentsUploading(false);
      });
  }

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
    if (
      !currentSessionId ||
      activeRunRef.current ||
      hasRunningManualMaintenance(conversation) ||
      pendingCompactionRequestIdRef.current ||
      socket.current?.readyState !== WebSocket.OPEN
    )
      return;
    const requestId = crypto.randomUUID();
    pendingCompactionRequestIdRef.current = requestId;
    compactionStartedRef.current = false;
    setManualMaintenancePending(true);
    compactionTimeoutRef.current = setTimeout(() => {
      if (pendingCompactionRequestIdRef.current !== requestId) return;
      clearManualMaintenancePending();
      setError(toWorkbenchError('command', undefined, t('operationIncomplete')));
    }, 15_000);
    sendCommand(
      {
        type: 'session.compact',
        websiteId,
        sessionId: currentSessionId,
        payload: {},
      },
      requestId,
    );
  }, [conversation, currentSessionId, clearManualMaintenancePending, sendCommand, t, websiteId]);

  const requestPreview = useCallback(
    (payload: Extract<AgentEvent, { type: 'preview.request' }>['payload']) => {
      const epoch = previewEpochRef.current;
      const operation = previewOperationRef.current.then(async () => {
        if (previewEpochRef.current !== epoch) throw new Error('Preview request expired');
        let recovered = false;
        while (true) {
          try {
            const client = await ensurePreviewReady({
              ensureAccess: payload.operation !== 'observe',
              isCurrent: () => previewEpochRef.current === epoch,
            });
            if (previewEpochRef.current !== epoch) throw new Error('Preview request expired');
            const response =
              payload.operation === 'refresh' &&
              previewRefreshGenerationRef.current === previewDirtyGenerationRef.current
                ? { ok: true as const, observation: await client.observe() }
                : await handlePreviewRequest(client, payload);
            if (previewEpochRef.current !== epoch) throw new Error('Preview request expired');
            if (response.ok) {
              setPreview((current) => ({ ...current, path: response.observation.path }));
              setError((current) => (shouldClearErrorOnRecovery(current) ? undefined : current));
            }
            return response;
          } catch (cause) {
            if (recovered || !isPreviewTimeout(cause)) throw cause;
            recovered = true;
            await ensurePreviewAuthorizationFresh({ force: true });
            if (previewEpochRef.current !== epoch)
              throw new Error('Preview request expired', { cause });
            setPreviewKey((current) => current + 1);
          }
        }
      });
      previewOperationRef.current = operation.catch(() => undefined);
      return operation;
    },
    [ensurePreviewAuthorizationFresh, ensurePreviewReady, setError],
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
        setError((current) => (current?.source === 'connection' ? undefined : current));
        sendCommand({
          type: 'session.attach',
          websiteId,
          payload: { sessionId: currentSessionId },
        });
        registerPreviewClient();
      };

      ws.onclose = (event) => {
        if (disposed || socket.current !== ws) return;
        socket.current = null;
        clearManualMaintenancePending();
        failPendingPrompt(t('connectionInterrupted'), event.code !== 1008);
        if (event.code === 1008) {
          return;
        }

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
        let pendingPromptToFailAfterSnapshot: string | undefined;

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
          onSessionChange?.({
            id: nextSession.id,
            title: nextSession.title,
            createdAt: nextSession.createdAt,
            updatedAt: nextSession.updatedAt,
            lastActiveAt: nextSession.lastActiveAt,
            pinnedAt: nextSession.pinnedAt,
            clonedFromSessionId: nextSession.clonedFromSessionId,
          });
        }
        if (projected.event.type === 'run.started' && currentSessionId) {
          onSessionChange?.({
            id: currentSessionId,
            lastActiveAt: new Date().toISOString(),
          });
        }

        // Handle preview requests
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
                { type: 'preview.response', websiteId, sessionId: currentSessionId, payload },
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
          if (projected.envelope.requestId === pendingPromptRequestIdRef.current)
            pendingPromptAckedRef.current = true;
          pendingInteractionRequestsRef.current.delete(projected.envelope.requestId);
          const pendingTitle = pendingSessionTitlesRef.current.get(projected.envelope.requestId);
          if (pendingTitle) {
            pendingSessionTitlesRef.current.delete(projected.envelope.requestId);
            onSessionChange?.({
              id: pendingTitle.sessionId,
              title: pendingTitle.title,
            });
          }
        }

        if (projected.event.type === 'command.error') {
          if (projected.envelope.requestId === pendingCompactionRequestIdRef.current)
            clearManualMaintenancePending();
          if (projected.envelope.requestId === pendingPromptRequestIdRef.current)
            pendingPromptRequestIdRef.current = undefined;
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

        if (
          projected.event.type === 'context.compaction.started' &&
          pendingCompactionRequestIdRef.current
        ) {
          compactionStartedRef.current = true;
        }

        if (
          compactionStartedRef.current &&
          (projected.event.type === 'context.compaction.completed' ||
            projected.event.type === 'context.compaction.failed' ||
            projected.event.type === 'context.compaction.not_needed')
        ) {
          clearManualMaintenancePending();
        }

        if (projected.event.type === 'run.started' || projected.event.type === 'run.settled') {
          pendingPromptRequestIdRef.current = undefined;
          pendingPromptAckedRef.current = false;
        }

        if (projected.event.type === 'session.snapshot') {
          const pendingRequestId = pendingPromptRequestIdRef.current;
          const activePromptRequestId = projected.event.payload.activeRun?.promptRequestId;
          if (pendingRequestId && activePromptRequestId !== pendingRequestId) {
            pendingPromptToFailAfterSnapshot = pendingRequestId;
          }
        }

        handleEvent(
          projected.event,
          projected.envelope,
          queueConversation,
          flushConversation,
          setRunIdState,
          setError,
          schedulePreviewRefresh,
          markPreviewDirty,
        );
        if (pendingPromptToFailAfterSnapshot) failPendingPrompt(t('connectionInterrupted'), false);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearManualMaintenancePending();
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
    markPreviewDirty,
    failPendingPrompt,
    clearManualMaintenancePending,
    setRunIdState,
    t,
  ]);

  const previewBelongsToWebsite = previewStateWebsiteIdRef.current === websiteId;
  const visiblePreview = previewBelongsToWebsite ? preview : { status: 'loading' as const };
  const visiblePreviewCurrentUrl = previewBelongsToWebsite ? previewCurrentUrl : undefined;
  const visiblePreviewCurrentPath = previewBelongsToWebsite ? previewCurrentPath : undefined;
  const pendingInitialPrompt =
    initialPrompt && conversation.turns.length === 0 && !error ? initialPrompt.text : undefined;

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
          pendingPrompt={pendingInitialPrompt}
          sessionLoading={sessionSnapshotVersion === 0}
          draft={draft}
          running={Boolean(runId)}
          error={error}
          disabled={!currentSessionId || attachmentsUploading}
          manualMaintenanceItems={conversation.manualMaintenanceItems}
          manualMaintenanceRunning={hasRunningManualMaintenance(conversation)}
          manualMaintenancePending={manualMaintenancePending}
          contextUsage={conversation.contextUsage}
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
          onReferenceUpload={uploadReferenceFile}
          attachments={attachments}
          uploadingAttachmentNames={uploadingAttachmentNames}
          onAttachmentSelect={selectAttachments}
          onAttachmentRemove={(id) =>
            setAttachments((current) => current.filter((item) => item.id !== id))
          }
          modelProfiles={modelProfiles}
          selectedModelProfileId={selectedModelProfileId}
          onModelProfileSelect={selectModelProfile}
          onModelProfileChange={(profiles) => {
            setModelProfiles(profiles);
            const current = selectedModelProfileId;
            const nextProfileId =
              current && profiles.some((profile) => profile.id === current)
                ? current
                : (profiles.find((profile) => profile.isDefault)?.id ?? profiles[0]?.id);
            setSelectedModelProfileId(nextProfileId);
            if (nextProfileId)
              window.localStorage.setItem(
                `cloudcrane:selected-model-profile:${websiteId}`,
                nextProfileId,
              );
          }}
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
          onRefresh={() => void refreshPreview('user')}
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
    PREVIEW_READY_TIMEOUT_MS,
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
  schedulePreviewRefresh: (runId?: string) => void,
  markPreviewDirty: () => void,
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
  if (event.type === 'context.usage.updated') {
    queueConversation({ type: 'context.usage.updated', payload: event.payload }, true);
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
    schedulePreviewRefresh(event.payload.runId ?? envelope.runId);
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
          contextUsage: event.payload.contextUsage,
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
    if (['edit', 'write', 'bash'].includes(event.payload.toolName)) markPreviewDirty();
  }
  if (event.type === 'interaction.requested') {
    if ('accept' in event.payload) {
      const payload = event.payload as Extract<
        AgentEvent,
        { type: 'interaction.requested' }
      >['payload'] & { accept: ['.zip']; maxBytes: number };
      queueConversation({ type: 'reference_upload.requested', payload }, true);
    } else queueConversation({ type: 'interaction.requested', payload: event.payload }, true);
  }
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
