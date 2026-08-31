'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '@cloudcrane/agent-protocol';
import {
  agentWebSocketUrl,
  command,
  createAgentSession,
  listAgentSessions,
  parseAgentEvent,
  parseAgentMessage,
} from '../../../../lib/agent-client';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
  status?: string;
};
type Session = { id: string; title: string | null; createdAt: string; updatedAt: string };

export default function AgentWorkbench({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = use(params);
  const socket = useRef<WebSocket | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState<string>();

  const send = useCallback(
    (payload: Parameters<WebSocket['send']>[0]) => socket.current?.send(payload),
    [],
  );
  const sendCommand = useCallback(
    (input: Parameters<typeof command>[0]) => send(JSON.stringify(command(input))),
    [send],
  );

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
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnection('reconnecting');
        retryTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => setError('Agent Service 连接异常');
      ws.onmessage = (event) => {
        const message = parseAgentMessage(String(event.data));
        const productEvent = message ? parseAgentEvent(message) : null;
        if (productEvent) handleEvent(productEvent, setMessages, setRunId, setError);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      const ws = socket.current;
      ws?.close();
      if (socket.current === ws) socket.current = null;
    };
  }, [sendCommand, sessionId, websiteId]);

  function submit() {
    const text = draft.trim();
    if (!text || !sessionId) return;
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'user', text }]);
    sendCommand({ type: 'agent.prompt', websiteId, sessionId, payload: { text } });
    setDraft('');
  }

  const stop = () =>
    sessionId && sendCommand({ type: 'agent.abort', websiteId, sessionId, payload: {} });
  const sessionLabel = (session: Session) =>
    session.title || `新会话 · ${new Date(session.createdAt).toLocaleDateString('zh-CN')}`;

  return (
    <main className="workbench">
      <aside className="session-rail">
        <div className="brand-lockup">
          <span className="mark">CC</span>
          <span>筑云鹤</span>
        </div>
        <div className="rail-heading">
          <span>Agent sessions</span>
          <button
            type="button"
            onClick={() =>
              void createAgentSession(websiteId).then(({ session }) => {
                setSessions((current) => [session, ...current]);
                setSessionId(session.id);
              })
            }
          >
            +
          </button>
        </div>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              className={session.id === sessionId ? 'session active' : 'session'}
              key={session.id}
              type="button"
              onClick={() => setSessionId(session.id)}
            >
              {sessionLabel(session)}
            </button>
          ))}
        </div>
      </aside>
      <section className="agent-panel">
        <header className="agent-header">
          <div>
            <span className="eyebrow">CLOUDCRANE / WEBSITE AGENT</span>
            <h1>Build inside the workspace.</h1>
          </div>
          <span className={`connection ${connection}`}>{connection}</span>
        </header>
        {error && (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError(undefined)}>
              ×
            </button>
          </div>
        )}
        <div className="conversation" aria-live="polite">
          {messages.length === 0 && (
            <div className="empty-state">
              <span className="status-dot" />
              <h2>What shall we build?</h2>
              <p>
                Describe a change. The Agent will work against this Website&apos;s remote workspace.
              </p>
            </div>
          )}
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <span className="message-role">
                {message.role === 'tool' ? message.toolName || 'tool' : message.role}
              </span>
              <p>{message.text || (message.status === 'running' ? 'running…' : '')}</p>
            </article>
          ))}
          {runId && (
            <div className="run-indicator">
              <span className="status-dot" /> Agent run {runId.slice(0, 8)}…
            </div>
          )}
        </div>
        <footer className="composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask the Agent to change the website…"
          />
          <div className="composer-actions">
            <span>Enter to send · Shift+Enter for newline</span>
            {runId && (
              <button type="button" onClick={stop}>
                Stop
              </button>
            )}
            <button className="send-button" type="button" onClick={submit}>
              Send ↗
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

function handleEvent(
  event: AgentEvent,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setRunId: React.Dispatch<React.SetStateAction<string | undefined>>,
  setError: React.Dispatch<React.SetStateAction<string | undefined>>,
) {
  if (event.type === 'run.started') setRunId(event.payload.runId);
  if (event.type === 'run.settled') setRunId(undefined);
  if (event.type === 'command.error') setError(event.payload.message);
  if (event.type === 'assistant.started')
    setMessages((current) => [
      ...current,
      { id: event.payload.messageId, role: 'assistant', text: '' },
    ]);
  if (event.type === 'assistant.delta')
    setMessages((current) =>
      current.map((message) =>
        message.id === event.payload.messageId
          ? { ...message, text: message.text + event.payload.text }
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
        text: event.payload.input ?? '',
        status: 'running',
      },
    ]);
  if (event.type === 'tool.updated')
    setMessages((current) =>
      current.map((message) =>
        message.id === event.payload.toolCallId
          ? { ...message, text: event.payload.output ?? message.text }
          : message,
      ),
    );
  if (event.type === 'tool.completed')
    setMessages((current) =>
      current.map((message) =>
        message.id === event.payload.toolCallId
          ? { ...message, text: event.payload.output ?? message.text, status: event.payload.status }
          : message,
      ),
    );
  if (event.type === 'session.snapshot') setMessages(event.payload.messages);
}
