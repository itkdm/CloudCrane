import type { SnapshotMessage } from '@cloudcrane/agent-protocol';
import type { Message } from './types';

export type ConversationState = { messages: Message[] };

export const initialConversationState: ConversationState = { messages: [] };

export type ConversationEvent =
  | { type: 'batch'; actions: ConversationEvent[] }
  | {
      type: 'session.snapshot';
      payload: { messages: SnapshotMessage[]; session?: unknown; activeRun?: unknown };
    }
  | { type: 'user.added'; payload: { message: Message } }
  | { type: 'message.status'; payload: { requestId?: string; status: string } }
  | { type: 'assistant.started'; payload: { messageId: string } }
  | { type: 'assistant.delta'; payload: { messageId: string; text: string } }
  | { type: 'assistant.completed'; payload: { messageId: string; text: string } }
  | { type: 'tool.started'; payload: { toolCallId: string; toolName: string; input?: string } }
  | { type: 'tool.updated'; payload: { toolCallId: string; toolName?: string; output?: string } }
  | {
      type: 'tool.completed';
      payload: { toolCallId: string; toolName?: string; output?: string; status: string };
    };

export function conversationReducer(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  if (event.type === 'batch') return event.actions.reduce(conversationReducer, state);
  if (event.type === 'session.snapshot')
    return { messages: event.payload.messages.map(projectSnapshotMessage) };
  if (event.type === 'user.added')
    return { messages: upsertMessage(state.messages, event.payload.message) };
  if (event.type === 'message.status') {
    if (!event.payload.requestId) return state;
    return {
      messages: state.messages.map((message) =>
        message.requestId === event.payload.requestId
          ? { ...message, status: event.payload.status }
          : message,
      ),
    };
  }
  if (event.type === 'assistant.started')
    return {
      messages: upsertMessage(state.messages, {
        id: event.payload.messageId,
        role: 'assistant',
        text: '',
        status: 'streaming',
      }),
    };
  if (event.type === 'assistant.delta')
    return {
      messages: upsertMessage(
        state.messages,
        {
          id: event.payload.messageId,
          role: 'assistant',
          text: event.payload.text,
          status: 'streaming',
        },
        true,
      ),
    };
  if (event.type === 'assistant.completed')
    return {
      messages: upsertMessage(
        state.messages,
        {
          id: event.payload.messageId,
          role: 'assistant',
          text: event.payload.text,
          status: 'completed',
        },
        false,
        true,
      ),
    };
  if (event.type === 'tool.started')
    return {
      messages: upsertTool(
        state.messages,
        event.payload.toolCallId,
        event.payload.toolName,
        event.payload.input,
        undefined,
        'running',
      ),
    };
  if (event.type === 'tool.updated')
    return {
      messages: updateTool(
        state.messages,
        event.payload.toolCallId,
        event.payload.toolName,
        event.payload.output,
        undefined,
      ),
    };
  return {
    messages: updateTool(
      state.messages,
      event.payload.toolCallId,
      event.payload.toolName,
      event.payload.output,
      event.payload.status,
    ),
  };
}

function upsertMessage(
  messages: Message[],
  next: Message,
  appendText = false,
  preserveNonEmptyText = false,
): Message[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) return [...messages, next];
  const current = messages[index];
  if (!current) return messages;
  const merged: Message = {
    ...current,
    ...next,
    text: appendText ? `${current.text ?? ''}${next.text ?? ''}` : next.text,
  };
  if (next.role === 'assistant' && !next.text && current.text) merged.text = current.text;
  if (preserveNonEmptyText && !next.text && current.text) merged.text = current.text;
  return messages.map((message, currentIndex) => (currentIndex === index ? merged : message));
}

function upsertTool(
  messages: Message[],
  id: string,
  toolName: string,
  input: string | undefined,
  output: string | undefined,
  status: string,
): Message[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0)
    return [
      ...messages,
      { id, role: 'tool', toolCallId: id, toolName, toolInput: input, toolOutput: output, status },
    ];
  const current = messages[index];
  if (!current) return messages;
  const updated: Message = {
    ...current,
    role: 'tool',
    toolCallId: current.toolCallId ?? id,
    toolName: toolName || current.toolName,
    toolInput: current.toolInput ?? input,
    toolOutput: output ?? current.toolOutput,
    status,
  };
  return messages.map((message, currentIndex) => (currentIndex === index ? updated : message));
}

function updateTool(
  messages: Message[],
  id: string,
  toolName: string | undefined,
  output: string | undefined,
  status: string | undefined,
): Message[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0)
    return [
      ...messages,
      {
        id,
        role: 'tool',
        toolCallId: id,
        toolName: toolName ?? 'tool',
        toolOutput: output,
        status: status ?? 'running',
      },
    ];
  const current = messages[index];
  if (!current) return messages;
  return messages.map((message, currentIndex) =>
    currentIndex === index
      ? {
          ...message,
          toolName: message.toolName ?? toolName,
          toolOutput: output ?? message.toolOutput,
          status: status ?? message.status,
        }
      : message,
  );
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
