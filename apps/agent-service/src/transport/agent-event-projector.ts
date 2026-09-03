import { randomUUID } from 'node:crypto';
import type { AgentWireMessage } from '@cloudcrane/agent-protocol';
import { createAgentEnvelope } from '@cloudcrane/agent-protocol';
import type { WebsiteAgentEvent, WebsiteAgentLifecycleEvent } from '@cloudcrane/website-agent';

const MAX_SUMMARY_BYTES = 512;
const MAX_TURN_INDEX = 1_000_000;
const activeAssistantMessageIds = new Map<string, string>();
const finalCandidateMessageIds = new Map<string, string>();
const turnStates = new Map<string, { nextIndex: number; currentIndex?: number; turnId?: string }>();

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
        ...(lifecycle.promptRequestId ? { promptRequestId: lifecycle.promptRequestId } : {}),
      },
    });
  if (lifecycle?.type === 'run_settled') {
    const key = assistantKey(event);
    activeAssistantMessageIds.delete(assistantKey(event));
    const finalMessageId = lifecycle.finalMessageId ?? finalCandidateMessageIds.get(key);
    finalCandidateMessageIds.delete(key);
    turnStates.delete(key);
    return createAgentEnvelope({
      ...base,
      type: 'run.settled',
      payload: {
        runId: lifecycle.runId,
        traceId: lifecycle.traceId,
        status: lifecycle.status,
        ...(lifecycle.error ? { error: lifecycle.error } : {}),
        ...(finalMessageId ? { finalMessageId } : {}),
      },
    });
  }
  const value = event.event as unknown as Record<string, unknown>;
  const key = assistantKey(event);
  if (value.type === 'context_compaction') {
    const status = value.status;
    if (
      status === 'started' ||
      status === 'completed' ||
      status === 'failed' ||
      status === 'not_needed'
    )
      return createAgentEnvelope({
        ...base,
        type: `context.compaction.${status}`,
        payload: { operation: 'compaction' },
      });
    return null;
  }
  if (value.type === 'turn_start' || value.type === 'turn_end') {
    const state = turnStates.get(key) ?? { nextIndex: 0 };
    const turnIndex = validTurnIndex(event.turnIndex) ?? state.currentIndex ?? state.nextIndex;
    const turnId = event.turnId ?? `${event.runId ?? event.websiteSessionId}:turn:${turnIndex}`;
    state.currentIndex = turnIndex;
    state.turnId = turnId;
    if (value.type === 'turn_start') {
      finalCandidateMessageIds.delete(key);
      turnStates.set(key, state);
      return createAgentEnvelope({
        ...base,
        type: 'turn.started',
        payload: { turnIndex, turnId },
      });
    }
    state.nextIndex = Math.min(turnIndex + 1, MAX_TURN_INDEX);
    state.currentIndex = undefined;
    turnStates.set(key, state);
    return createAgentEnvelope({
      ...base,
      type: 'turn.completed',
      payload: {
        turnIndex,
        turnId,
      },
    });
  }
  const state = turnStates.get(key);
  const turnFields =
    state?.currentIndex === undefined
      ? {}
      : { turnIndex: state.currentIndex, turnId: state.turnId };
  switch (value.type) {
    case 'message_start':
      if (!isAssistantMessage(value.message)) return null;
      return createAgentEnvelope({
        ...base,
        type: 'assistant.started',
        payload: { messageId: startAssistantMessage(event, value.message), ...turnFields },
      });
    case 'message_update': {
      if (!isAssistantMessage(value.message)) return null;
      const delta = extractDelta(value.assistantMessageEvent);
      return delta
        ? createAgentEnvelope({
            ...base,
            type: 'assistant.delta',
            payload: {
              messageId: activeAssistantMessage(event, value.message),
              text: delta,
              ...turnFields,
            },
          })
        : null;
    }
    case 'message_end': {
      if (!isAssistantMessage(value.message)) return null;
      const projected = createAgentEnvelope({
        ...base,
        type: 'assistant.completed',
        payload: {
          messageId: activeAssistantMessage(event, value.message),
          text: extractText(value.message),
          ...turnFields,
        },
      });
      const messageId = (projected.payload as { messageId: string }).messageId;
      if (hasToolCall(value.message)) finalCandidateMessageIds.delete(key);
      else finalCandidateMessageIds.set(key, messageId);
      activeAssistantMessageIds.delete(assistantKey(event));
      return projected;
    }
    case 'tool_execution_start':
      finalCandidateMessageIds.delete(key);
      return createAgentEnvelope({
        ...base,
        type: 'tool.started',
        payload: {
          toolCallId: stringValue(value.toolCallId),
          toolName: stringValue(value.toolName),
          input: summarize(value.args),
          ...turnFields,
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
          ...turnFields,
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
          ...turnFields,
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

function hasToolCall(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const content = (message as { content?: unknown }).content;
  return (
    Array.isArray(content) &&
    content.some((part) => {
      return Boolean(
        part && typeof part === 'object' && (part as { type?: unknown }).type === 'toolCall',
      );
    })
  );
}

function assistantKey(event: WebsiteAgentEvent): string {
  return `${event.websiteId}:${event.websiteSessionId}:${event.runId ?? 'no-run'}`;
}

function startAssistantMessage(event: WebsiteAgentEvent, message?: unknown): string {
  const id = stableMessageId(message) ?? randomUUID();
  activeAssistantMessageIds.set(assistantKey(event), id);
  return id;
}

function activeAssistantMessage(event: WebsiteAgentEvent, message?: unknown): string {
  const key = assistantKey(event);
  const existing = activeAssistantMessageIds.get(key);
  if (existing) return existing;
  const id = stableMessageId(message) ?? randomUUID();
  activeAssistantMessageIds.set(key, id);
  return id;
}

function stableMessageId(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const value = message as { id?: unknown; role?: unknown; timestamp?: unknown };
  const sourceId = typeof value.id === 'string' && value.id.length > 0 ? value.id : undefined;
  if (sourceId) return sourceId;
  if (typeof value.timestamp === 'number' && Number.isFinite(value.timestamp))
    return `pi:${stringValue(value.role) ?? 'message'}:${value.timestamp}`;
  return undefined;
}

function extractDelta(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if ((value as { type?: unknown }).type !== 'text_delta') return '';
  const delta = (value as { delta?: unknown }).delta;
  return typeof delta === 'string' ? delta.slice(0, MAX_SUMMARY_BYTES) : '';
}

function validTurnIndex(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TURN_INDEX
    ? value
    : undefined;
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
