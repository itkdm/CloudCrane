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

  it('accepts an optional W3C traceparent on commands without changing legacy fields', () => {
    const command = agentCommandSchema.parse({
      type: 'agent.prompt',
      requestId: 'req-traceparent',
      websiteId,
      sessionId,
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      timestamp: new Date().toISOString(),
      payload: { text: 'hello' },
    });
    expect(command.traceparent).toContain('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(command.requestId).toBe('req-traceparent');
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

  it('accepts nullable context usage in snapshots and live events', () => {
    const usage = { tokens: 12_400, contextWindow: 200_000, percent: 6.2 };
    expect(
      agentEventSchema.parse({
        type: 'context.usage.updated',
        payload: { contextUsage: usage },
      }),
    ).toEqual({ type: 'context.usage.updated', payload: { contextUsage: usage } });
    const unknownUsage = agentEventSchema.parse({
      type: 'context.usage.updated',
      payload: { contextUsage: { tokens: null, contextWindow: 200_000, percent: null } },
    });
    expect(unknownUsage).toEqual({
      type: 'context.usage.updated',
      payload: { contextUsage: { tokens: null, contextWindow: 200_000, percent: null } },
    });
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

  it('validates question interaction commands and events', () => {
    const command = agentCommandSchema.parse({
      type: 'interaction.respond',
      requestId: 'interaction-1',
      websiteId,
      sessionId,
      timestamp: new Date(),
      payload: {
        interactionId: '00000000-0000-4000-8000-000000000003',
        response: { type: 'option', optionIndex: 0 },
      },
    });
    expect(command.type).toBe('interaction.respond');
    expect(() =>
      agentCommandSchema.parse({
        type: 'interaction.respond',
        requestId: 'bad',
        websiteId,
        sessionId,
        timestamp: new Date(),
        payload: {
          interactionId: '00000000-0000-4000-8000-000000000003',
          response: { type: 'custom', value: '' },
        },
      }),
    ).toThrow();
    expect(
      agentEventSchema.parse({
        type: 'interaction.requested',
        payload: {
          interactionId: '00000000-0000-4000-8000-000000000003',
          kind: 'question',
          toolCallId: 'call-1',
          question: 'Choose',
          options: [{ label: 'A' }],
          allowCustom: true,
          createdAt: new Date().toISOString(),
        },
      }).type,
    ).toBe('interaction.requested');
  });
});
