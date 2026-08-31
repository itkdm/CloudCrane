'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  AgentEnvelope,
  AgentEvent,
  PreviewCapability,
  SnapshotMessage,
} from '@cloudcrane/agent-protocol';
import {
  agentWebSocketUrl,
  command,
  createAgentSession,
  getPreviewUrl,
  listAgentSessions,
  parseAgentEvent,
  parseAgentMessage,
} from '../../../../../../lib/agent-client';
import { PreviewBridgeClient } from '../../../../../../lib/preview-bridge-client';
import { ChatPanel } from './chat-panel';
import { PreviewPane } from './preview-pane';
import { SessionSidebar } from './session-sidebar';
import type { Message, PreviewState, Session } from './types';
import { WorkbenchHeader } from './workbench-header';

export function AgentWorkbench({ websiteId }: { websiteId: string }) {
  const socket = useRef<WebSocket | null>(null);
  const previewFrame = useRef<HTMLIFrameElement | null>(null);
  const previewBridge = useRef<PreviewBridgeClient | null>(null);
  const previewClientIdRef = useRef<string | undefined>(undefined);
  const previewCapabilitiesRef = useRef<PreviewCapability[] | undefined>(undefined);
  const activeRunRef = useRef<string | undefined>(undefined);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [runId, setRunIdState] = useState<string>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [previewKey, setPreviewKey] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState('waiting');

  const setRunId = useCallback((value: string | undefined) => {
    activeRunRef.current = value;
    setRunIdState(value);
  }, []);

  const refreshPreview = useCallback(() => {
    if (previewBridge.current) {
      void previewBridge.current.refresh().catch((cause) => {
        setError(cause instanceof Error ? cause.message : '预览刷新失败');
      });
    } else setPreviewKey((current) => current + 1);
  }, []);

  const schedulePreviewRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refreshPreview, 300);
  }, [refreshPreview]);

  const sendCommand = useCallback((input: Parameters<typeof command>[0], requestId?: string) => {
    const next = command(input);
    if (requestId) next.requestId = requestId;
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(next));
  }, []);

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

  useEffect(() => {
    const key = `cloudcrane.previewClientId.${websiteId}`;
    const stored = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, stored);
    previewClientIdRef.current = stored;
  }, [websiteId]);

  useEffect(() => {
    let cancelled = false;
    void getPreviewUrl(websiteId)
      .then(({ url }) => !cancelled && setPreview({ status: 'ready', url }))
      .catch((cause) => {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : '预览暂不可用';
          setPreview({
            status: /not ready|stopped/i.test(message) ? 'stopped' : 'unavailable',
            message,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [websiteId]);

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
        if (!cancelled) setError(cause instanceof Error ? cause.message : '无法读取 Agent 会话');
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
        setConnection('connected');
        sendCommand({ type: 'session.attach', websiteId, payload: { sessionId } });
        registerPreviewClient();
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnection('reconnecting');
        retryTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => setError('Agent 服务连接异常');
      ws.onmessage = (event) => {
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
        if (projected.event.type === 'preview.request') {
          const client = previewBridge.current;
          if (!client) {
            sendCommand(
              {
                type: 'preview.response',
                websiteId,
                sessionId,
                payload: {
                  ok: false,
                  error: { code: 'CLIENT_UNAVAILABLE', message: 'Preview Client is not connected' },
                },
              },
              projected.envelope.requestId,
            );
          } else {
            void handlePreviewRequest(client, projected.event.payload)
              .then((payload) => {
                sendCommand(
                  { type: 'preview.response', websiteId, sessionId, payload },
                  projected.envelope.requestId,
                );
              })
              .catch((cause) => {
                sendCommand(
                  {
                    type: 'preview.response',
                    websiteId,
                    sessionId,
                    payload: {
                      ok: false,
                      error: {
                        code: 'PREVIEW_PROTOCOL_ERROR',
                        message: cause instanceof Error ? cause.message : 'Preview request failed',
                      },
                    },
                  },
                  projected.envelope.requestId,
                );
              });
          }
          return;
        }
        handleEvent(
          projected.event,
          projected.envelope,
          setMessages,
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
      const current = socket.current;
      current?.close();
      if (socket.current === current) socket.current = null;
    };
  }, [registerPreviewClient, schedulePreviewRefresh, sendCommand, sessionId, setRunId, websiteId]);

  useEffect(() => {
    if (preview.status !== 'ready' || !preview.url || !previewFrame.current) return;
    const client = new PreviewBridgeClient(previewFrame.current, preview.url, (capabilities) => {
      previewCapabilitiesRef.current = capabilities;
      setBridgeStatus('connected');
      registerPreviewClient();
    });
    previewBridge.current = client;
    return () => {
      client.dispose();
      if (previewBridge.current === client) previewBridge.current = null;
      setBridgeStatus('waiting');
    };
  }, [preview.status, preview.url, registerPreviewClient]);

  function submit() {
    const text = draft.trim();
    if (!text || !sessionId) return;
    const requestId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: requestId, requestId, role: 'user', text, status: 'pending' },
    ]);
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(
        JSON.stringify({
          ...command({ type: 'agent.prompt', websiteId, sessionId, payload: { text } }),
          requestId,
        }),
      );
    } else {
      setMessages((current) =>
        current.map((message) =>
          message.requestId === requestId ? { ...message, status: 'failed' } : message,
        ),
      );
      setError('Agent 服务尚未连接');
    }
    setDraft('');
  }

  function createSession() {
    void createAgentSession(websiteId)
      .then(({ session }) => {
        setSessions((current) => [session, ...current]);
        setSessionId(session.id);
        setMessages([]);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '无法新建对话'));
  }

  const stop = () => {
    if (sessionId) sendCommand({ type: 'agent.abort', websiteId, sessionId, payload: {} });
  };

  return (
    <main className="workbench">
      <WorkbenchHeader connection={connection} />
      <div className="workbench-body">
        <SessionSidebar
          sessions={sessions}
          sessionId={sessionId}
          onSelect={setSessionId}
          onCreate={createSession}
        />
        <ChatPanel
          messages={messages}
          draft={draft}
          running={Boolean(runId)}
          error={error}
          disabled={!sessionId}
          onDraftChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          onDismissError={() => setError(undefined)}
          onExample={setDraft}
        />
        <PreviewPane
          preview={preview}
          previewKey={previewKey}
          frameRef={previewFrame}
          bridgeStatus={bridgeStatus}
          onRefresh={refreshPreview}
          onOpen={() => preview.url && window.open(preview.url, '_blank', 'noopener,noreferrer')}
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
  setMessages: Dispatch<SetStateAction<Message[]>>,
  setRunId: (value: string | undefined) => void,
  setError: Dispatch<SetStateAction<string | undefined>>,
  schedulePreviewRefresh: () => void,
) {
  if (event.type === 'run.started') setRunId(event.payload.runId);
  if (event.type === 'run.settled') {
    setRunId(undefined);
    schedulePreviewRefresh();
  }
  if (event.type === 'command.ack')
    setMessages((current) =>
      current.map((message) =>
        message.requestId === envelope.requestId ? { ...message, status: 'accepted' } : message,
      ),
    );
  if (event.type === 'command.error') {
    setError(event.payload.message);
    setMessages((current) =>
      current.map((message) =>
        message.requestId === envelope.requestId ? { ...message, status: 'failed' } : message,
      ),
    );
  }
  if (event.type === 'session.snapshot') {
    setMessages(event.payload.messages.map(projectSnapshotMessage));
    setRunId(event.payload.activeRun?.runId);
  }
  if (event.type === 'assistant.started')
    setMessages((current) => [
      ...current,
      { id: event.payload.messageId, role: 'assistant', text: '' },
    ]);
  if (event.type === 'assistant.delta')
    setMessages((current) =>
      current.map((message) =>
        message.id === event.payload.messageId
          ? { ...message, text: (message.text ?? '') + event.payload.text }
          : message,
      ),
    );
  if (event.type === 'assistant.completed')
    setMessages((current) =>
      current.map((message) =>
        message.id === event.payload.messageId ? { ...message, text: event.payload.text } : message,
      ),
    );
  if (event.type === 'tool.started')
    setMessages((current) => [
      ...current,
      {
        id: event.payload.toolCallId,
        role: 'tool',
        toolName: event.payload.toolName,
        toolInput: event.payload.input,
        status: 'running',
      },
    ]);
  if (event.type === 'tool.updated')
    setMessages((current) =>
      current.map((message) =>
        message.id === event.payload.toolCallId
          ? { ...message, toolOutput: event.payload.output ?? message.toolOutput }
          : message,
      ),
    );
  if (event.type === 'tool.completed') {
    setMessages((current) =>
      current.map((message) =>
        message.id === event.payload.toolCallId
          ? {
              ...message,
              toolOutput: event.payload.output ?? message.toolOutput,
              status: event.payload.status,
            }
          : message,
      ),
    );
    if (['edit', 'write', 'bash'].includes(event.payload.toolName)) schedulePreviewRefresh();
  }
}

function projectSnapshotMessage(message: SnapshotMessage): Message {
  if (message.role !== 'tool') return { ...message };
  return {
    id: message.id,
    role: 'tool',
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    toolOutput: message.text || undefined,
    status: message.status,
  };
}
