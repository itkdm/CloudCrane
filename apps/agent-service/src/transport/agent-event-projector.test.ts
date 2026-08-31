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

  it('assigns a fresh UUID to every assistant turn and keeps deltas correlated', () => {
    const message = { role: 'assistant', content: [] } as never;
    const first = projectWebsiteAgentEvent({
      ...context,
      runId: 'run-1',
      event: { type: 'message_start', message },
    });
    const firstDelta = projectWebsiteAgentEvent({
      ...context,
      runId: 'run-1',
      event: {
        type: 'message_update',
        message,
        assistantMessageEvent: { delta: 'one' } as never,
      },
    });
    const firstEnd = projectWebsiteAgentEvent({
      ...context,
      runId: 'run-1',
      event: { type: 'message_end', message },
    });
    const second = projectWebsiteAgentEvent({
      ...context,
      runId: 'run-1',
      event: { type: 'message_start', message },
    });
    expect(first?.payload).toMatchObject({ messageId: expect.any(String) });
    expect(firstDelta?.payload).toMatchObject({
      messageId: (first?.payload as { messageId: string }).messageId,
    });
    expect(firstEnd?.payload).toMatchObject({
      messageId: (first?.payload as { messageId: string }).messageId,
    });
    expect((second?.payload as { messageId: string }).messageId).not.toBe(
      (first?.payload as { messageId: string }).messageId,
    );
  });

  it('cleans the assistant correlation state when a run settles without message_end', () => {
    const message = { role: 'assistant', content: [] } as never;
    const started = projectWebsiteAgentEvent({
      ...context,
      runId: 'run-cleanup',
      event: { type: 'message_start', message },
    });
    projectWebsiteAgentEvent({
      ...context,
      runId: 'run-cleanup',
      event: {
        type: 'run_settled',
        runId: 'run-cleanup',
        traceId: 'trace-cleanup',
        status: 'FAILED',
      },
    });
    const update = projectWebsiteAgentEvent({
      ...context,
      runId: 'run-cleanup',
      event: {
        type: 'message_update',
        message,
        assistantMessageEvent: { delta: 'after cleanup' } as never,
      },
    });
    expect((update?.payload as { messageId: string }).messageId).not.toBe(
      (started?.payload as { messageId: string }).messageId,
    );
  });
});
