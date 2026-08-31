import { randomUUID } from 'node:crypto';
import type { AgentWireMessage } from '@cloudcrane/agent-protocol';
import { createAgentEnvelope } from '@cloudcrane/agent-protocol';
import type { WebsiteAgentEvent, WebsiteAgentLifecycleEvent } from '@cloudcrane/website-agent';

const MAX_SUMMARY_BYTES = 512;
const activeAssistantMessageIds = new Map<string, string>();

export function projectWebsiteAgentEvent(event: WebsiteAgentEvent): AgentWireMessage | null {
  const base = {
    requestId: `event:${randomUUID()}`,
    websiteId: event.websiteId,
    sessionId: event.websiteSessionId,
    runId: event.runId,
    traceId: event.traceId,
  };
  const lifecycle = event.event as WebsiteAgentLifecycleEvent | undefined;
  if (lifecycle?.type === 'run_started')
    return createAgentEnvelope({
      ...base,
      type: 'run.started',
      payload: {
        runId: lifecycle.runId,
        traceId: lifecycle.traceId,
        ...(lifecycle.previewClientId ? { previewClientId: lifecycle.previewClientId } : {}),
      },
    });
  if (lifecycle?.type === 'run_settled') {
    activeAssistantMessageIds.delete(assistantKey(event));
    return createAgentEnvelope({
      ...base,
      type: 'run.settled',
      payload: {
        runId: lifecycle.runId,
        traceId: lifecycle.traceId,
        status: lifecycle.status,
        ...(lifecycle.error ? { error: lifecycle.error } : {}),
      },
    });
  }
  const value = event.event as unknown as Record<string, unknown>;
  switch (value.type) {
    case 'message_start':
      if (!isAssistantMessage(value.message)) return null;
      return createAgentEnvelope({
        ...base,
        type: 'assistant.started',
        payload: { messageId: startAssistantMessage(event) },
      });
    case 'message_update': {
      if (!isAssistantMessage(value.message)) return null;
      const delta = extractDelta(value.assistantMessageEvent);
      return delta
        ? createAgentEnvelope({
            ...base,
            type: 'assistant.delta',
            payload: { messageId: activeAssistantMessage(event), text: delta },
          })
        : null;
    }
    case 'message_end': {
      if (!isAssistantMessage(value.message)) return null;
      const projected = createAgentEnvelope({
        ...base,
        type: 'assistant.completed',
        payload: { messageId: activeAssistantMessage(event), text: extractText(value.message) },
      });
      activeAssistantMessageIds.delete(assistantKey(event));
      return projected;
    }
    case 'tool_execution_start':
      return createAgentEnvelope({
        ...base,
        type: 'tool.started',
        payload: {
          toolCallId: stringValue(value.toolCallId),
          toolName: stringValue(value.toolName),
          input: summarize(value.args),
        },
      });
    case 'tool_execution_update':
      return createAgentEnvelope({
        ...base,
        type: 'tool.updated',
        payload: {
          toolCallId: stringValue(value.toolCallId),
          toolName: stringValue(value.toolName),
          output: summarize(value.partialResult),
        },
      });
    case 'tool_execution_end':
      return createAgentEnvelope({
        ...base,
        type: 'tool.completed',
        payload: {
          toolCallId: stringValue(value.toolCallId),
          toolName: stringValue(value.toolName),
          status: value.isError ? 'error' : 'completed',
          output: summarize(value.result),
        },
      });
    case 'queue_update':
      return createAgentEnvelope({
        ...base,
        type: 'queue.updated',
        payload: { steering: arrayLength(value.steering), followUp: arrayLength(value.followUp) },
      });
    default:
      return null;
  }
}

function isAssistantMessage(message: unknown): message is Record<string, unknown> {
  return Boolean(
    message && typeof message === 'object' && (message as { role?: unknown }).role === 'assistant',
  );
}

function assistantKey(event: WebsiteAgentEvent): string {
  return `${event.websiteId}:${event.websiteSessionId}:${event.runId ?? 'no-run'}`;
}

function startAssistantMessage(event: WebsiteAgentEvent): string {
  const id = randomUUID();
  activeAssistantMessageIds.set(assistantKey(event), id);
  return id;
}

function activeAssistantMessage(event: WebsiteAgentEvent): string {
  const key = assistantKey(event);
  const existing = activeAssistantMessageIds.get(key);
  if (existing) return existing;
  const id = randomUUID();
  activeAssistantMessageIds.set(key, id);
  return id;
}

function extractDelta(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const delta = (value as { delta?: unknown }).delta;
  return typeof delta === 'string' ? delta.slice(0, MAX_SUMMARY_BYTES) : '';
}

function extractText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: 'text'; text: string } =>
      Boolean(
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
      ),
    )
    .map((part) => part.text)
    .join('')
    .slice(0, 32_000);
}

function summarize(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[summary unavailable]';
  }
  return redactSecrets(text).slice(0, MAX_SUMMARY_BYTES);
}

function redactSecrets(value: string): string {
  return value.replace(
    /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)(\s*[:=]\s*)(["']?)[^\s,"'}]+\3/gi,
    '$1$2$3[redacted]$3',
  );
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : 'unknown';
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
