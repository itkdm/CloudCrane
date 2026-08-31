import { describe, expect, it } from 'vitest';
import { agentWireMessageSchema } from '@cloudcrane/agent-protocol';
import { projectWebsiteAgentEvent } from './agent-event-projector.js';

const context = {
  websiteId: '00000000-0000-4000-8000-000000000001',
  websiteSessionId: '00000000-0000-4000-8000-000000000002',
  piSessionId: 'pi-session',
};

describe('agent event projector', () => {
  it('projects Pi tool events into bounded product envelopes', () => {
    const message = projectWebsiteAgentEvent({
      ...context,
      event: {
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'secret should not be expanded' },
      },
    });
    expect(message?.type).toBe('tool.started');
    expect(message?.payload).toMatchObject({ toolCallId: 'call-1', toolName: 'bash' });
    expect(agentWireMessageSchema.parse(message).type).toBe('tool.started');
    expect(JSON.stringify(message)).not.toContain('rawPiEvent');
  });

  it('never forwards unrelated Pi events', () => {
    expect(projectWebsiteAgentEvent({ ...context, event: { type: 'agent_start' } })).toBeNull();
  });
});
