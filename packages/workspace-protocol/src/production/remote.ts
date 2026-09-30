import { z } from 'zod';
import { productionOperationPayloadSchemas } from './operations.js';

const productionClientOperationCommonSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().uuid(),
  websiteId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  agentRunId: z.string().uuid().optional(),
  toolCallId: z.string().min(1).max(255).optional(),
  traceparent: z.string().max(255).optional(),
  deadlineMs: z.number().int().positive().max(300_000),
  idempotencyKey: z.string().min(1).max(255).optional(),
});

const productionRunnerOperationCommonSchema = productionClientOperationCommonSchema.extend({
  type: z.literal('production.operation'),
});

export const productionClientOperationSchema = z.discriminatedUnion('operation', [
  productionClientOperationCommonSchema.extend({
    operation: z.literal('release.stage'),
    payload: productionOperationPayloadSchemas['release.stage'],
  }),
  productionClientOperationCommonSchema.extend({
    operation: z.literal('production.ensure'),
    payload: productionOperationPayloadSchemas['production.ensure'],
  }),
  productionClientOperationCommonSchema.extend({
    operation: z.literal('production.deploy'),
    payload: productionOperationPayloadSchemas['production.deploy'],
  }),
  productionClientOperationCommonSchema.extend({
    operation: z.literal('production.status'),
    payload: productionOperationPayloadSchemas['production.status'],
  }),
  productionClientOperationCommonSchema.extend({
    operation: z.literal('production.authorize'),
    payload: productionOperationPayloadSchemas['production.authorize'],
  }),
  productionClientOperationCommonSchema.extend({
    operation: z.literal('production.destroy'),
    payload: productionOperationPayloadSchemas['production.destroy'],
  }),
] as const);

export const productionRunnerOperationSchema = z.discriminatedUnion('operation', [
  productionRunnerOperationCommonSchema.extend({
    operation: z.literal('release.stage'),
    payload: productionOperationPayloadSchemas['release.stage'],
  }),
  productionRunnerOperationCommonSchema.extend({
    operation: z.literal('production.ensure'),
    payload: productionOperationPayloadSchemas['production.ensure'],
  }),
  productionRunnerOperationCommonSchema.extend({
    operation: z.literal('production.deploy'),
    payload: productionOperationPayloadSchemas['production.deploy'],
  }),
  productionRunnerOperationCommonSchema.extend({
    operation: z.literal('production.status'),
    payload: productionOperationPayloadSchemas['production.status'],
  }),
  productionRunnerOperationCommonSchema.extend({
    operation: z.literal('production.authorize'),
    payload: productionOperationPayloadSchemas['production.authorize'],
  }),
  productionRunnerOperationCommonSchema.extend({
    operation: z.literal('production.destroy'),
    payload: productionOperationPayloadSchemas['production.destroy'],
  }),
] as const);

export type ProductionClientOperation = z.infer<typeof productionClientOperationSchema>;
export type ProductionRunnerOperation = z.infer<typeof productionRunnerOperationSchema>;
