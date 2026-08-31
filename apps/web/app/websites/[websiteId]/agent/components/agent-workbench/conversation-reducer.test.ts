import { describe, expect, it } from 'vitest';
import {
  conversationReducer,
  initialConversationState,
  type ConversationEvent,
} from './conversation-reducer';

function reduce(state: ReturnType<typeof conversationReducer>, event: ConversationEvent) {
  return conversationReducer(state, event);
}

describe('conversationReducer', () => {
  it('projects snapshots without pretending tool text is tool input', () => {
    const state = reduce(initialConversationState, {
      type: 'session.snapshot',
      payload: {
        messages: [
          {
            id: 'tool-1',
            role: 'tool',
            text: 'command output',
            toolCallId: 'tool-1',
            toolName: 'bash',
            status: 'completed',
          },
        ],
      },
    });

    expect(state.messages[0]).toMatchObject({ toolOutput: 'command output' });
    expect(state.messages[0]).not.toHaveProperty('toolInput');
  });

  it('upserts assistant events and preserves streamed text when completion is empty', () => {
    let state = reduce(initialConversationState, {
      type: 'assistant.delta',
      payload: { messageId: 'assistant-1', text: '先到这里' },
    });
    state = reduce(state, {
      type: 'assistant.completed',
      payload: { messageId: 'assistant-1', text: '' },
    });
    state = reduce(state, {
      type: 'assistant.started',
      payload: { messageId: 'assistant-1' },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: 'assistant-1',
      text: '先到这里',
      status: 'streaming',
    });
  });

  it('keeps tool input stable while output and status evolve', () => {
    let state = reduce(initialConversationState, {
      type: 'tool.started',
      payload: { toolCallId: 'tool-1', toolName: 'read', input: '/workspace/index.html' },
    });
    state = reduce(state, {
      type: 'tool.updated',
      payload: { toolCallId: 'tool-1', toolName: 'read', output: 'partial result' },
    });
    state = reduce(state, {
      type: 'tool.completed',
      payload: {
        toolCallId: 'tool-1',
        toolName: 'read',
        status: 'completed',
        output: 'final result',
      },
    });

    expect(state.messages).toEqual([
      expect.objectContaining({
        toolInput: '/workspace/index.html',
        toolOutput: 'final result',
        status: 'completed',
      }),
    ]);
  });

  it('is idempotent for duplicate starts and creates missing tool updates safely', () => {
    let state = reduce(initialConversationState, {
      type: 'tool.started',
      payload: { toolCallId: 'tool-1', toolName: 'read', input: 'first-input' },
    });
    state = reduce(state, {
      type: 'tool.started',
      payload: { toolCallId: 'tool-1', toolName: 'read', input: 'second-input' },
    });
    state = reduce(state, {
      type: 'tool.updated',
      payload: { toolCallId: 'tool-2', toolName: 'ls', output: 'directory' },
    });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ toolInput: 'first-input' });
    expect(state.messages[1]).toMatchObject({
      id: 'tool-2',
      toolOutput: 'directory',
      status: 'running',
    });
  });
});
