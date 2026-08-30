import { z } from 'zod';
import { remoteErrorSchema } from '../errors.js';
import { workspaceOperationVariants } from '../workspace/operations.js';

export const runnerRegisterSchema = z.object({
  type: z.literal('runner.register'),
  runnerId: z.string().uuid(),
  name: z.string().min(1).max(255),
  version: z.string().min(1).max(64),
  capabilities: z.array(z.string().min(1)).max(128),
  region: z.string().max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const runnerRegisteredSchema = z.object({
  type: z.literal('runner.registered'),
  runnerId: z.string().uuid(),
  heartbeatIntervalMs: z.number().int().positive(),
  serverTime: z.coerce.date(),
});

export const runnerHeartbeatSchema = z.object({
  type: z.literal('runner.heartbeat'),
  runnerId: z.string().uuid(),
  timestamp: z.coerce.date(),
  workspaceCount: z.number().int().nonnegative().optional(),
});

const operationCommonSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().uuid(),
  websiteId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  agentRunId: z.string().uuid().optional(),
  deadlineMs: z.number().int().positive().max(300_000),
  idempotencyKey: z.string().min(1).max(255).optional(),
});

export const runnerOperationSchema = z.discriminatedUnion('operation', [
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[0].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[1].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[2].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[3].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[4].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[5].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[6].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[7].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[8].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[9].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[10].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[11].shape,
  }),
  operationCommonSchema.extend({
    type: z.literal('workspace.operation'),
    ...workspaceOperationVariants[12].shape,
  }),
] as const);

export const runnerAcceptedSchema = z.object({
  type: z.literal('runner.accepted'),
  requestId: z.string().uuid(),
  traceId: z.string().uuid(),
});

export const runnerCompletedSchema = z.object({
  type: z.literal('runner.completed'),
  requestId: z.string().uuid(),
  traceId: z.string().uuid(),
  result: z.unknown(),
  durationMs: z.number().int().nonnegative(),
});

export const runnerErrorSchema = z.object({
  type: z.literal('runner.error'),
  requestId: z.string().uuid(),
  traceId: z.string().uuid(),
  error: remoteErrorSchema,
  durationMs: z.number().int().nonnegative(),
  outcome: z.enum(['FAILED', 'UNKNOWN']),
});

export const runnerResultSchema = z.discriminatedUnion('type', [
  runnerAcceptedSchema,
  runnerCompletedSchema,
  runnerErrorSchema,
]);

export type RunnerRegister = z.infer<typeof runnerRegisterSchema>;
export type RunnerRegistered = z.infer<typeof runnerRegisteredSchema>;
export type RunnerHeartbeat = z.infer<typeof runnerHeartbeatSchema>;
export type RunnerOperation = z.infer<typeof runnerOperationSchema>;
export type RunnerResult = z.infer<typeof runnerResultSchema>;
