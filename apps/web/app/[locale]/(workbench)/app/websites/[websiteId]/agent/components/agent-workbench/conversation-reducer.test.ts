import { describe, expect, it } from 'vitest';
import {
  conversationReducer,
  initialConversationState,
  type ConversationEvent,
} from './conversation-reducer';

function reduce(...events: ConversationEvent[]) {
  return events.reduce(conversationReducer, initialConversationState);
}

const user = (id = 'user-1'): ConversationEvent => ({
  type: 'user.added',
  payload: { message: { id, role: 'user', text: '请修改首页', requestId: id, status: 'pending' } },
});

describe('conversationReducer turn presentation model', () => {
  it('restores a pending reference upload without treating it as a question', () => {
    const state = reduce(
      user(),
      {
        type: 'reference_upload.requested',
        payload: {
          interactionId: 'interaction-reference',
          toolCallId: 'tool-reference',
          accept: ['.zip'],
          maxBytes: 100,
        },
      },
    );
    expect(state.turns[0]?.execution?.[0]).toMatchObject({
      toolName: 'reference_upload',
      interaction: { kind: 'reference_upload', status: 'pending', accept: ['.zip'] },
    });
  });

  it('renders a cancelled question as a terminal state in live and snapshot flows', () => {
    let state = reduce(
      user(),
      {
        type: 'interaction.requested',
        payload: {
          interactionId: 'interaction-1',
          kind: 'question',
          toolCallId: 'tool-1',
          question: '继续吗？',
          options: [{ label: '继续' }],
          allowCustom: true,
        },
      },
      {
        type: 'tool.completed',
        payload: {
          toolCallId: 'tool-1',
          toolName: 'question',
          output: 'User cancelled the question',
          status: 'completed',
        },
      },
    );
    expect(state.turns[0]?.execution?.[0]).toMatchObject({
      interaction: { status: 'cancelled' },
    });

    state = conversationReducer(state, {
      type: 'session.snapshot',
      payload: {
        messages: [
          { id: 'user-1', role: 'user', text: '请修改首页' },
          {
            id: 'tool-1',
            role: 'tool',
            text: 'User cancelled the question',
            toolCallId: 'tool-1',
            toolName: 'question',
            input: JSON.stringify({ question: '继续吗？', options: [{ label: '继续' }] }),
            output: 'User cancelled the question',
            status: 'completed',
          },
        ],
      },
    });
    expect(state.turns[0]?.execution?.[0]).toMatchObject({
      interaction: { status: 'cancelled' },
    });
  });

  it('does not treat a question response as answered before tool completion', () => {
    const state = reduce(user(), {
      type: 'interaction.requested',
      payload: {
        interactionId: 'interaction-1',
        kind: 'question',
        toolCallId: 'tool-1',
        question: '继续吗？',
        options: [{ label: '继续' }],
        allowCustom: true,
      },
    });
    expect(state.turns[0]?.execution?.[0]).toMatchObject({
      interaction: { status: 'pending' },
      status: 'running',
    });
    expect(state.turns[0]?.execution?.[0]).not.toHaveProperty('interaction.answer');
  });

  it('returns a question to pending when the response command fails', () => {
    const state = reduce(
      user(),
      {
        type: 'interaction.requested',
        payload: {
          interactionId: 'interaction-1',
          kind: 'question',
          toolCallId: 'tool-1',
          question: '继续吗？',
          options: [{ label: '继续' }],
          allowCustom: true,
        },
      },
      {
        type: 'interaction.failed',
        payload: { interactionId: 'interaction-1', error: 'interaction is no longer pending' },
      },
    );
    expect(state.turns[0]?.execution?.[0]).toMatchObject({
      status: 'running',
      interaction: { status: 'pending', error: 'interaction is no longer pending' },
    });
  });

  it('restores custom question answers from completed tool output', () => {
    const state = reduce({
      type: 'session.snapshot',
      payload: {
        messages: [
          { id: 'user-1', role: 'user', text: '请修改首页' },
          {
            id: 'tool-1',
            role: 'tool',
            text: 'User provided: 米白色杂志风',
            toolCallId: 'tool-1',
            toolName: 'question',
            input: JSON.stringify({ question: '风格？', options: [{ label: '简洁' }] }),
            output: 'User provided: 米白色杂志风',
            status: 'completed',
          },
        ],
      },
    });
    expect(state.turns[0]?.execution?.[0]).toMatchObject({
      interaction: { status: 'answered', answer: '米白色杂志风', wasCustom: true },
    });
  });

  it('anchors manual compaction without creating a chat turn', () => {
    const state = reduce(
      user(),
      { type: 'context.compaction.started' },
      { type: 'context.compaction.completed' },
    );

    expect(state.manualMaintenanceItems).toEqual([
      expect.objectContaining({
        operation: 'compaction',
        status: 'completed',
        afterTurnId: 'user-1',
      }),
    ]);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.userMessage.text).toBe('请修改首页');
  });

  it('removes a manual compaction that was not needed without adding an error item', () => {
    const state = reduce(
      user(),
      { type: 'context.compaction.started' },
      { type: 'context.compaction.not_needed' },
    );

    expect(state.manualMaintenanceItems).toEqual([]);
    expect(state.turns).toHaveLength(1);
  });

  it('keeps chat-only turns free of an empty execution', () => {
    const state = reduce(
      user(),
      { type: 'assistant.started', payload: { messageId: 'answer-1' } },
      { type: 'assistant.delta', payload: { messageId: 'answer-1', text: '已完成' } },
      { type: 'assistant.completed', payload: { messageId: 'answer-1', text: '已完成' } },
      { type: 'run.settled', payload: { status: 'COMPLETED' } },
    );

    expect(state.turns).toEqual([
      expect.objectContaining({
        finalAnswer: expect.objectContaining({ id: 'answer-1', text: '已完成' }),
        status: 'completed',
        expanded: false,
      }),
    ]);
    expect(state.turns[0]).not.toHaveProperty('execution');
    expect(state.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('stores intermediate assistant narrative and multiple paired tools', () => {
    const state = reduce(
      user(),
      { type: 'assistant.delta', payload: { messageId: 'narrative', text: '我先检查一下。' } },
      { type: 'assistant.completed', payload: { messageId: 'narrative', text: '我先检查一下。' } },
      {
        type: 'tool.started',
        payload: { toolCallId: 'tool-1', toolName: 'read', input: 'a.html' },
      },
      {
        type: 'tool.completed',
        payload: { toolCallId: 'tool-1', toolName: 'read', output: 'A', status: 'completed' },
      },
      {
        type: 'tool.updated',
        payload: { toolCallId: 'tool-2', toolName: 'write', output: 'written' },
      },
      {
        type: 'tool.started',
        payload: { toolCallId: 'tool-2', toolName: 'write', input: 'b.html' },
      },
      {
        type: 'tool.completed',
        payload: {
          toolCallId: 'tool-2',
          toolName: 'write',
          output: 'written',
          status: 'completed',
        },
      },
      { type: 'assistant.completed', payload: { messageId: 'answer-1', text: '修改完成。' } },
      { type: 'run.settled', payload: { status: 'COMPLETED', finalMessageId: 'answer-1' } },
    );

    const turn = state.turns[0];
    expect(turn?.execution).toEqual([
      expect.objectContaining({ kind: 'assistant', id: 'narrative', text: '我先检查一下。' }),
      expect.objectContaining({
        kind: 'tool',
        toolCallId: 'tool-1',
        toolInput: 'a.html',
        toolOutput: 'A',
        status: 'completed',
      }),
      expect.objectContaining({
        kind: 'tool',
        toolCallId: 'tool-2',
        toolInput: 'b.html',
        toolOutput: 'written',
        status: 'completed',
      }),
    ]);
    expect(turn?.finalAnswer).toMatchObject({ id: 'answer-1', text: '修改完成。' });
    expect(
      turn?.execution?.some((step) => step.kind === 'tool' && step.toolInput === step.toolOutput),
    ).toBe(false);
  });

  it('uses the latest completed assistant as a reliable final candidate', () => {
    const state = reduce(
      user(),
      { type: 'assistant.completed', payload: { messageId: 'intermediate', text: '正在处理。' } },
      { type: 'tool.started', payload: { toolCallId: 'tool-1', toolName: 'bash', input: 'build' } },
      {
        type: 'tool.completed',
        payload: { toolCallId: 'tool-1', toolName: 'bash', output: 'ok', status: 'completed' },
      },
      { type: 'assistant.completed', payload: { messageId: 'final', text: '处理完成。' } },
      { type: 'run.settled', payload: { status: 'COMPLETED' } },
    );

    expect(state.turns[0]?.finalAnswer?.id).toBe('final');
    expect(state.turns[0]?.execution?.map((step) => step.kind)).toEqual(['assistant', 'tool']);
  });

  it('uses authoritative completion text instead of the longest streamed value', () => {
    const state = reduce(
      user(),
      { type: 'assistant.delta', payload: { messageId: 'answer-1', text: '较长的临时内容' } },
      { type: 'assistant.completed', payload: { messageId: 'answer-1', text: '完成' } },
    );

    expect(state.turns[0]?.execution).toEqual([
      expect.objectContaining({ id: 'answer-1', text: '完成', status: 'completed' }),
    ]);
  });

  it('defaults live turns expanded and collapses them on settlement', () => {
    let state = reduce(user(), {
      type: 'tool.started',
      payload: { toolCallId: 'tool-1', toolName: 'read' },
    });
    expect(state.turns[0]?.expanded).toBe(true);
    state = conversationReducer(state, {
      type: 'run.settled',
      payload: { status: 'COMPLETED', finalMessageId: 'missing' },
    });
    expect(state.turns[0]).toMatchObject({ status: 'no-final-text', expanded: false });
    expect(state.turns[0]?.error).toContain('final answer');
  });

  it('represents failed and aborted runs with clear terminal statuses', () => {
    const failed = reduce(user('failed'), {
      type: 'run.settled',
      payload: { status: 'FAILED', error: '工具失败' },
    });
    const aborted = reduce(user('aborted'), {
      type: 'run.settled',
      payload: { status: 'ABORTED' },
    });
    expect(failed.turns[0]).toMatchObject({ status: 'error', error: '工具失败', expanded: false });
    expect(aborted.turns[0]).toMatchObject({
      status: 'aborted',
      error: 'Agent run aborted',
      expanded: false,
    });
  });

  it('projects completed snapshots collapsed and merges live details without duplicates', () => {
    let state = reduce(user(), {
      type: 'tool.started',
      payload: { toolCallId: 'tool-1', toolName: 'read', input: 'live-input' },
    });
    state = conversationReducer(state, {
      type: 'session.snapshot',
      payload: {
        messages: [
          { id: 'user-1', role: 'user', text: '请修改首页' },
          {
            id: 'tool-1',
            role: 'tool',
            text: 'snapshot-output',
            toolCallId: 'tool-1',
            toolName: 'read',
            status: 'completed',
          },
          { id: 'answer-1', role: 'assistant', text: '历史答案', status: 'completed' },
        ],
      },
    });

    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]).toMatchObject({
      status: 'completed',
      expanded: false,
      finalAnswer: { id: 'answer-1' },
    });
    expect(state.turns[0]?.execution).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-1',
        toolInput: 'live-input',
        toolOutput: 'snapshot-output',
      }),
    ]);
  });

  it('is safe for duplicate and out-of-order tool events', () => {
    const state = reduce(
      user(),
      { type: 'tool.updated', payload: { toolCallId: 'tool-1', output: 'full output' } },
      {
        type: 'tool.started',
        payload: { toolCallId: 'tool-1', toolName: 'read', input: 'first input' },
      },
      {
        type: 'tool.started',
        payload: { toolCallId: 'tool-1', toolName: 'read', input: 'second input' },
      },
      {
        type: 'tool.completed',
        payload: { toolCallId: 'tool-1', status: 'completed', output: 'full output' },
      },
      { type: 'tool.updated', payload: { toolCallId: 'tool-1', output: 'short' } },
    );

    expect(state.turns[0]?.execution).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-1',
        toolInput: 'first input',
        toolOutput: 'full output',
        status: 'completed',
      }),
    ]);
  });

  it('keeps snapshot tool output separate and bounded', () => {
    const output = 'x'.repeat(40_000);
    const state = reduce({
      type: 'session.snapshot',
      payload: {
        messages: [
          { id: 'user-1', role: 'user', text: '查看文件' },
          { id: 'tool-1', role: 'tool', text: output, toolCallId: 'tool-1', toolName: 'read' },
        ],
      },
    });
    const step = state.turns[0]?.execution?.[0];
    expect(step).toMatchObject({ kind: 'tool', toolOutput: output.slice(0, 32_000) });
    expect(step).not.toHaveProperty('toolInput');
    expect(step?.kind === 'tool' ? step.toolOutput?.length : 0).toBe(32_000);
  });
});

it('reconciles a snapshot with a live turn even when transport ids differ', () => {
  const state = conversationReducer(
    reduce(user('request-1'), {
      type: 'assistant.completed',
      payload: { messageId: 'live-answer', text: '完成' },
    }),
    {
      type: 'session.snapshot',
      payload: {
        messages: [
          { id: 'pi-user-entry', role: 'user', text: '请修改首页' },
          { id: 'pi-answer-entry', role: 'assistant', text: '完成', status: 'completed' },
        ],
      },
    },
  );

  expect(state.turns).toHaveLength(1);
  expect(state.turns[0]?.finalAnswer?.text).toBe('完成');
});

it('preserves assistant and tool ordering when rebuilding a snapshot', () => {
  const state = reduce({
    type: 'session.snapshot',
    payload: {
      messages: [
        { id: 'user-1', role: 'user', text: '执行两步' },
        { id: 'assistant-1', role: 'assistant', text: '先读文件', status: 'completed' },
        {
          id: 'tool-1',
          role: 'tool',
          text: '',
          toolCallId: 'tool-1',
          toolName: 'read',
          input: 'a.html',
          output: 'A',
          status: 'completed',
        },
        { id: 'assistant-2', role: 'assistant', text: '再写文件', status: 'completed' },
        {
          id: 'tool-2',
          role: 'tool',
          text: '',
          toolCallId: 'tool-2',
          toolName: 'write',
          input: 'b.html',
          output: 'B',
          status: 'completed',
        },
        { id: 'assistant-3', role: 'assistant', text: '全部完成', status: 'completed' },
      ],
    },
  });

  expect(state.turns[0]?.execution?.map((step) => step.id)).toEqual([
    'assistant-1',
    'tool-1',
    'assistant-2',
    'tool-2',
  ]);
  expect(state.turns[0]?.finalAnswer?.id).toBe('assistant-3');
});

describe('context maintenance timeline placement', () => {
  it('places automatic maintenance in the matching run execution', () => {
    const running = reduce(
      user(),
      { type: 'run.started', payload: { runId: 'run-1' } },
      {
        type: 'context.compaction.started',
        payload: { runId: 'run-1' },
      },
    );
    const step = running.turns[0]?.execution?.[0];
    expect(step).toMatchObject({ kind: 'context-maintenance', status: 'running' });
    const completed = reduce(
      user(),
      { type: 'run.started', payload: { runId: 'run-1' } },
      {
        type: 'context.compaction.started',
        payload: { runId: 'run-1' },
      },
      { type: 'context.compaction.completed', payload: { runId: 'run-1' } },
    );
    expect(completed.turns[0]?.execution).toHaveLength(1);
    expect(completed.turns[0]?.execution?.[0]).toMatchObject({ id: step?.id, status: 'completed' });
    expect(completed.manualMaintenanceItems).toHaveLength(0);
  });

  it('marks automatic failure without creating a manual item', () => {
    const state = reduce(
      user(),
      { type: 'run.started', payload: { runId: 'run-1' } },
      {
        type: 'context.compaction.started',
        payload: { runId: 'run-1' },
      },
      { type: 'context.compaction.failed', payload: { runId: 'run-1' } },
    );
    expect(state.turns[0]?.execution?.[0]).toMatchObject({
      kind: 'context-maintenance',
      status: 'error',
    });
    expect(state.manualMaintenanceItems).toEqual([]);
  });

  it('anchors multiple manual items and preserves their positions', () => {
    const state = reduce(
      user('user-1'),
      { type: 'context.compaction.started' },
      { type: 'context.compaction.completed' },
      user('user-2'),
      { type: 'context.compaction.started' },
      { type: 'context.compaction.failed' },
      user('user-3'),
    );
    expect(state.manualMaintenanceItems).toEqual([
      expect.objectContaining({
        id: 'manual-compaction-0',
        afterTurnId: 'user-1',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'manual-compaction-1',
        afterTurnId: 'user-2',
        status: 'error',
      }),
    ]);
  });

  it('restores running maintenance as automatic or manual from a snapshot', () => {
    const automatic = reduce({
      type: 'session.snapshot',
      payload: {
        messages: [{ id: 'user-1', role: 'user', text: '继续' }],
        activeRun: { runId: 'run-snapshot', status: 'RUNNING' },
        contextMaintenance: { operation: 'compaction', status: 'running' },
      },
    });
    expect(automatic.turns[0]?.execution?.[0]).toMatchObject({
      kind: 'context-maintenance',
      status: 'running',
    });
    expect(automatic.manualMaintenanceItems).toHaveLength(0);
    const manual = reduce({
      type: 'session.snapshot',
      payload: {
        messages: [{ id: 'user-1', role: 'user', text: '继续' }],
        contextMaintenance: { operation: 'compaction', status: 'running' },
      },
    });
    expect(manual.manualMaintenanceItems[0]).toMatchObject({
      status: 'running',
      afterTurnId: 'user-1',
    });
  });
});

describe('empty session snapshot reset boundary', () => {
  it('clears turns, manual items, and automatic execution steps', () => {
    const state = reduce(
      user('session-a-turn'),
      { type: 'run.started', payload: { runId: 'session-a-run' } },
      { type: 'context.compaction.started', payload: { runId: 'session-a-run' } },
      { type: 'context.compaction.completed' },
      { type: 'context.compaction.started' },
      { type: 'session.snapshot', payload: { messages: [] } },
    );
    expect(state).toEqual({ turns: [], messages: [], manualMaintenanceItems: [] });
  });

  it('restores only current snapshot manual maintenance after an empty reset', () => {
    const state = reduce(
      user('session-a-turn'),
      { type: 'context.compaction.started' },
      { type: 'context.compaction.completed' },
      {
        type: 'session.snapshot',
        payload: {
          messages: [],
          contextMaintenance: { operation: 'compaction', status: 'running' },
        },
      },
    );
    expect(state.turns).toEqual([]);
    expect(state.manualMaintenanceItems).toEqual([
      expect.objectContaining({ status: 'running', afterTurnId: undefined }),
    ]);
  });

  it('does not append session A turns to a later non-empty session B snapshot', () => {
    const state = reduce(
      user('session-a-turn'),
      { type: 'context.compaction.started' },
      { type: 'context.compaction.completed' },
      { type: 'session.snapshot', payload: { messages: [] } },
      {
        type: 'session.snapshot',
        payload: {
          messages: [{ id: 'session-b-turn', role: 'user', text: 'B' }],
        },
      },
    );
    expect(state.turns.map((turn) => turn.userMessage.id)).toEqual(['session-b-turn']);
    expect(state.manualMaintenanceItems).toEqual([]);
  });
});
