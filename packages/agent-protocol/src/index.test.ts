import { describe, expect, it } from 'vitest';
import { agentCommandSchema, agentEnvelopeSchema, agentEventSchema } from './index.js';

const websiteId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';

describe('agent protocol', () => {
  it('validates commands and envelopes independently from Pi', () => {
    const command = agentCommandSchema.parse({
      type: 'session.attach',
      requestId: 'req-1',
      websiteId,
      timestamp: new Date().toISOString(),
      payload: { sessionId },
    });
    expect(command.type).toBe('session.attach');
    expect(agentEnvelopeSchema.parse({ ...command, payload: { ok: true } }).websiteId).toBe(
      websiteId,
    );
  });

  it('rejects raw-shaped or unknown product events', () => {
    expect(() => agentEventSchema.parse({ type: 'message_update', payload: {} })).toThrow();
    expect(() =>
      agentCommandSchema.parse({
        type: 'agent.prompt',
        requestId: 'x',
        websiteId,
        timestamp: new Date(),
        payload: { text: '' },
      }),
    ).toThrow();
  });

  it('accepts prompt correlation and reconstructable tool snapshot fields', () => {
    const command = agentCommandSchema.parse({
      type: 'agent.prompt',
      requestId: 'req-2',
      websiteId,
      sessionId,
      timestamp: new Date(),
      payload: { text: '继续', promptRequestId: 'prompt-2' },
    });
    if (command.type !== 'agent.prompt') throw new Error('expected prompt command');
    expect(command.payload.promptRequestId).toBe('prompt-2');
    const event = agentEventSchema.parse({
      type: 'tool.completed',
      payload: {
        toolCallId: 'call-1',
        toolName: 'read',
        status: 'completed',
        output: 'ok',
        turnIndex: 3,
        turnId: 'run:turn:3',
      },
    });
    expect(event.type).toBe('tool.completed');
  });

  it('accepts the maintenance command and bounded compaction events', () => {
    const command = agentCommandSchema.parse({
      type: 'session.compact',
      requestId: 'req-compact',
      websiteId,
      sessionId,
      timestamp: new Date(),
      payload: {},
    });
    expect(command.type).toBe('session.compact');
    const event = agentEventSchema.parse({
      type: 'context.compaction.completed',
      payload: { operation: 'compaction' },
    });
    expect(event).toEqual({
      type: 'context.compaction.completed',
      payload: { operation: 'compaction' },
    });
    expect(JSON.stringify(event)).not.toMatch(/summary|reason|token/i);
  });

  it('rejects non-finite and unbounded turn indexes', () => {
    expect(() =>
      agentEventSchema.parse({
        type: 'turn.started',
        payload: { turnIndex: Number.POSITIVE_INFINITY },
      }),
    ).toThrow();
    expect(() =>
      agentEventSchema.parse({
        type: 'assistant.delta',
        payload: { messageId: 'message-1', text: 'x', turnIndex: 1_000_001 },
      }),
    ).toThrow();
  });
});
