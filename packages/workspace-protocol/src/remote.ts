import { z } from 'zod';
import { runnerOperationSchema, runnerResultSchema } from './runner/messages.js';
import { operationPayloadSchemas } from './workspace/operations.js';

const clientOperationCommonSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().uuid(),
  websiteId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  agentRunId: z.string().uuid().optional(),
  deadlineMs: z.number().int().positive().max(300_000),
  idempotencyKey: z.string().min(1).max(255).optional(),
});

export const clientOperationSchema = z.discriminatedUnion('operation', [
  clientOperationCommonSchema.extend({
    operation: z.literal('runtime.create'),
    payload: operationPayloadSchemas['runtime.create'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('runtime.start'),
    payload: operationPayloadSchemas['runtime.start'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('runtime.stop'),
    payload: operationPayloadSchemas['runtime.stop'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('runtime.status'),
    payload: operationPayloadSchemas['runtime.status'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('runtime.destroy'),
    payload: operationPayloadSchemas['runtime.destroy'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('runtime.info'),
    payload: operationPayloadSchemas['runtime.info'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('fs.read'),
    payload: operationPayloadSchemas['fs.read'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('fs.write'),
    payload: operationPayloadSchemas['fs.write'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('fs.stat'),
    payload: operationPayloadSchemas['fs.stat'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('fs.list'),
    payload: operationPayloadSchemas['fs.list'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('fs.mkdir'),
    payload: operationPayloadSchemas['fs.mkdir'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('process.exec'),
    payload: operationPayloadSchemas['process.exec'],
  }),
  clientOperationCommonSchema.extend({
    operation: z.literal('process.cancel'),
    payload: operationPayloadSchemas['process.cancel'],
  }),
] as const);

export const gatewayOperationSchema = runnerOperationSchema;
export const gatewayResultSchema = runnerResultSchema;

export type ClientOperation = z.infer<typeof clientOperationSchema>;
