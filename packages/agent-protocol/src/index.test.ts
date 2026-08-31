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
});
