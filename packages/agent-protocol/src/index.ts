import { z } from 'zod';
import {
  previewClientRegisterPayloadSchema,
  previewClientCapabilitiesPayloadSchema,
  previewRequestPayloadSchema,
  previewResponsePayloadSchema,
} from '@cloudcrane/preview-protocol';
export type {
  PreviewCapability,
  PreviewClientRegisterPayload,
  PreviewClientCapabilitiesPayload,
  PreviewObservation,
  PreviewRequestPayload,
  PreviewResponsePayload,
} from '@cloudcrane/preview-protocol';

export const agentEnvelopeSchema = z.object({
  type: z.string().min(1),
  requestId: z.string().min(1),
  // connection.ready is emitted before the client selects a Website.
  websiteId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  traceId: z.string().uuid().optional(),
  timestamp: z.coerce.date(),
  payload: z.unknown(),
});
export type AgentEnvelope = z.infer<typeof agentEnvelopeSchema>;

const commandBase = z.object({
  requestId: z.string().min(1),
  websiteId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  timestamp: z.coerce.date(),
});

export const agentCommandSchema = z.discriminatedUnion('type', [
  commandBase.extend({
    type: z.literal('session.attach'),
    payload: z.object({ sessionId: z.string().uuid() }),
  }),
  commandBase.extend({
    type: z.literal('agent.prompt'),
    payload: z.object({
      text: z.string().min(1).max(32_000),
      promptRequestId: z.string().min(1).max(256).optional(),
    }),
  }),
  commandBase.extend({ type: z.literal('agent.abort'), payload: z.object({}) }),
  commandBase.extend({
    type: z.literal('agent.steer'),
    payload: z.object({ text: z.string().min(1).max(32_000) }),
  }),
  commandBase.extend({
    type: z.literal('agent.follow_up'),
    payload: z.object({ text: z.string().min(1).max(32_000) }),
  }),
  commandBase.extend({ type: z.literal('session.compact'), payload: z.object({}) }),
  commandBase.extend({
    type: z.literal('preview.client.register'),
    payload: previewClientRegisterPayloadSchema,
  }),
  commandBase.extend({
    type: z.literal('preview.client.capabilities'),
    payload: previewClientCapabilitiesPayloadSchema,
  }),
  commandBase.extend({
    type: z.literal('preview.response'),
    payload: previewResponsePayloadSchema,
  }),
  commandBase.extend({
    type: z.literal('interaction.respond'),
    payload: z.object({
      interactionId: z.string().uuid(),
      response: z.discriminatedUnion('type', [
        z.object({ type: z.literal('option'), optionIndex: z.number().int().nonnegative() }),
        z.object({ type: z.literal('custom'), value: z.string().trim().min(1).max(2_000) }),
      ]),
    }),
  }),
  commandBase.extend({
    type: z.literal('interaction.cancel'),
    payload: z.object({ interactionId: z.string().uuid() }),
  }),
]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;

export const sessionViewSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  status: z.enum(['NEW', 'ACTIVE', 'CLOSED']),
  piSessionId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActiveAt: z.string().nullable(),
});
export type AgentSessionView = z.infer<typeof sessionViewSchema>;

export const snapshotMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  text: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  input: z.string().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
  turnId: z.string().optional(),
  kind: z.string().optional(),
  status: z.enum(['running', 'completed', 'error']).optional(),
});
export type SnapshotMessage = z.infer<typeof snapshotMessageSchema>;

export const sessionSnapshotSchema = z.object({
  session: sessionViewSchema,
  messages: z.array(snapshotMessageSchema),
  contextMaintenance: z
    .object({ operation: z.literal('compaction'), status: z.literal('running') })
    .nullable()
    .optional(),
  activeRun: z
    .object({
      runId: z.string().uuid(),
      traceId: z.string().uuid(),
      previewClientId: z.string().uuid().optional(),
      promptRequestId: z.string().min(1).max(256).optional(),
      status: z.literal('RUNNING'),
    })
    .nullable(),
  pendingInteractions: z
    .array(
      z.object({
        interactionId: z.string().uuid(),
        kind: z.literal('question'),
        toolCallId: z.string(),
        question: z.string(),
        options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
        allowCustom: z.literal(true),
        createdAt: z.string(),
      }),
    )
    .default([]),
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connection.ready'),
    payload: z.object({ connectionId: z.string() }),
  }),
  z.object({
    type: z.literal('session.attached'),
    payload: z.object({ session: sessionViewSchema }),
  }),
  z.object({ type: z.literal('session.snapshot'), payload: sessionSnapshotSchema }),
  z.object({
    type: z.literal('context.compaction.started'),
    payload: z.object({ operation: z.literal('compaction') }),
  }),
  z.object({
    type: z.literal('context.compaction.completed'),
    payload: z.object({ operation: z.literal('compaction') }),
  }),
  z.object({
    type: z.literal('context.compaction.failed'),
    payload: z.object({ operation: z.literal('compaction') }),
  }),
  z.object({
    type: z.literal('context.compaction.not_needed'),
    payload: z.object({ operation: z.literal('compaction') }),
  }),
  z.object({
    type: z.literal('run.started'),
    payload: z.object({
      runId: z.string().uuid(),
      traceId: z.string().uuid(),
      previewClientId: z.string().uuid().optional(),
      promptRequestId: z.string().min(1).max(256).optional(),
    }),
  }),
  z.object({
    type: z.literal('run.settled'),
    payload: z.object({
      runId: z.string().uuid(),
      traceId: z.string().uuid(),
      status: z.enum(['COMPLETED', 'FAILED', 'ABORTED', 'INTERRUPTED']),
      error: z.string().optional(),
      finalMessageId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('turn.started'),
    payload: z.object({
      turnIndex: z.number().int().nonnegative().finite().max(1_000_000),
      turnId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('turn.completed'),
    payload: z.object({
      turnIndex: z.number().int().nonnegative().finite().max(1_000_000),
      turnId: z.string().optional(),
      finalMessageId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('assistant.started'),
    payload: z.object({
      messageId: z.string(),
      turnIndex: z.number().int().nonnegative().finite().max(1_000_000).optional(),
      turnId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('assistant.delta'),
    payload: z.object({
      messageId: z.string(),
      text: z.string(),
      turnIndex: z.number().int().nonnegative().finite().max(1_000_000).optional(),
      turnId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('assistant.completed'),
    payload: z.object({
      messageId: z.string(),
      text: z.string(),
      turnIndex: z.number().int().nonnegative().finite().max(1_000_000).optional(),
      turnId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('tool.started'),
    payload: z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      input: z.string().optional(),
      turnIndex: z.number().int().nonnegative().finite().max(1_000_000).optional(),
      turnId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('tool.updated'),
    payload: z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      output: z.string().optional(),
      turnIndex: z.number().int().nonnegative().finite().max(1_000_000).optional(),
      turnId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('tool.completed'),
    payload: z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      status: z.enum(['completed', 'error']),
      output: z.string().optional(),
      turnIndex: z.number().int().nonnegative().finite().max(1_000_000).optional(),
      turnId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('queue.updated'),
    payload: z.object({
      steering: z.number().int().nonnegative(),
      followUp: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    type: z.literal('preview.request'),
    payload: previewRequestPayloadSchema,
  }),
  z.object({ type: z.literal('command.ack'), payload: z.object({ commandType: z.string() }) }),
  z.object({
    type: z.literal('command.error'),
    payload: z.object({ code: z.string(), message: z.string() }),
  }),
  z.object({
    type: z.literal('interaction.requested'),
    payload: z.object({
      interactionId: z.string().uuid(),
      kind: z.literal('question'),
      toolCallId: z.string(),
      question: z.string(),
      options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
      allowCustom: z.literal(true),
      createdAt: z.string(),
    }),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const agentWireMessageSchema = agentEnvelopeSchema.extend({
  payload: z.unknown(),
});
export type AgentWireMessage = z.infer<typeof agentWireMessageSchema>;

export function createAgentEnvelope<T>(input: {
  type: string;
  requestId: string;
  websiteId?: string;
  sessionId?: string;
  runId?: string;
  traceId?: string;
  payload: T;
}): AgentWireMessage {
  return { ...input, timestamp: new Date(), payload: input.payload };
}
