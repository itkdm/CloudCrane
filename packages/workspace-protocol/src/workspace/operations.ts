import { z } from 'zod';
import {
  fsListResponseSchema,
  fsMkdirRequestSchema,
  fsMkdirResponseSchema,
  fsReadRequestSchema,
  fsReadResponseSchema,
  fsStatResponseSchema,
  fsWriteRequestSchema,
  fsWriteResponseSchema,
  processCancelRequestSchema,
  processCancelResponseSchema,
  processExecRequestSchema,
  processExecResponseSchema,
  runtimeInfoSchema,
} from '../daemon.js';

export const runtimeWorkspacePayloadSchema = z.object({});
export const operationPayloadSchemas = {
  'runtime.create': runtimeWorkspacePayloadSchema,
  'runtime.start': runtimeWorkspacePayloadSchema,
  'runtime.stop': runtimeWorkspacePayloadSchema,
  'runtime.status': runtimeWorkspacePayloadSchema,
  'runtime.destroy': runtimeWorkspacePayloadSchema,
  'runtime.info': runtimeWorkspacePayloadSchema,
  'fs.read': fsReadRequestSchema,
  'fs.write': fsWriteRequestSchema,
  'fs.stat': z.object({ path: z.string().min(1).max(4096) }),
  'fs.list': z.object({ path: z.string().min(1).max(4096) }),
  'fs.mkdir': fsMkdirRequestSchema,
  'process.exec': processExecRequestSchema,
  'process.cancel': processCancelRequestSchema,
} as const;

export const workspaceOperationVariants = [
  z.object({ operation: z.literal('runtime.create'), payload: runtimeWorkspacePayloadSchema }),
  z.object({ operation: z.literal('runtime.start'), payload: runtimeWorkspacePayloadSchema }),
  z.object({ operation: z.literal('runtime.stop'), payload: runtimeWorkspacePayloadSchema }),
  z.object({ operation: z.literal('runtime.status'), payload: runtimeWorkspacePayloadSchema }),
  z.object({ operation: z.literal('runtime.destroy'), payload: runtimeWorkspacePayloadSchema }),
  z.object({ operation: z.literal('runtime.info'), payload: runtimeWorkspacePayloadSchema }),
  z.object({ operation: z.literal('fs.read'), payload: fsReadRequestSchema }),
  z.object({ operation: z.literal('fs.write'), payload: fsWriteRequestSchema }),
  z.object({ operation: z.literal('fs.stat'), payload: operationPayloadSchemas['fs.stat'] }),
  z.object({ operation: z.literal('fs.list'), payload: operationPayloadSchemas['fs.list'] }),
  z.object({ operation: z.literal('fs.mkdir'), payload: fsMkdirRequestSchema }),
  z.object({ operation: z.literal('process.exec'), payload: processExecRequestSchema }),
  z.object({ operation: z.literal('process.cancel'), payload: processCancelRequestSchema }),
] as const;

export const workspaceOperationSchema = z.discriminatedUnion(
  'operation',
  workspaceOperationVariants,
);

export type WorkspaceOperation = z.infer<typeof workspaceOperationSchema>;
export type WorkspaceOperationName = WorkspaceOperation['operation'];

export const runtimeOperationResponseSchema = z.object({
  workspaceId: z.string().uuid(),
  status: z.enum(['created', 'running', 'stopped', 'missing', 'error']),
  containerRef: z.string().optional(),
  endpoint: z.string().optional(),
});

export const operationResultSchemas = {
  'runtime.create': runtimeOperationResponseSchema,
  'runtime.start': runtimeOperationResponseSchema,
  'runtime.stop': runtimeOperationResponseSchema,
  'runtime.status': runtimeOperationResponseSchema,
  'runtime.destroy': z.null(),
  'runtime.info': runtimeInfoSchema,
  'fs.read': fsReadResponseSchema,
  'fs.write': fsWriteResponseSchema,
  'fs.stat': fsStatResponseSchema,
  'fs.list': fsListResponseSchema,
  'fs.mkdir': fsMkdirResponseSchema,
  'process.exec': processExecResponseSchema,
  'process.cancel': processCancelResponseSchema,
} as const satisfies Record<WorkspaceOperationName, z.ZodTypeAny>;

export type OperationResult<K extends WorkspaceOperationName> = z.infer<
  (typeof operationResultSchemas)[K]
>;

export function operationResultSchemaFor<K extends WorkspaceOperationName>(
  operation: K,
): (typeof operationResultSchemas)[K] {
  return operationResultSchemas[operation];
}

const mutationOperations = new Set<WorkspaceOperationName>([
  'runtime.create',
  'runtime.start',
  'runtime.stop',
  'runtime.destroy',
  'fs.write',
  'fs.mkdir',
  'process.exec',
  'process.cancel',
]);

export function isMutationOperation(operation: WorkspaceOperationName): boolean {
  return mutationOperations.has(operation);
}

export const operationResultSchema = z.union([
  runtimeOperationResponseSchema,
  z.null(),
  runtimeInfoSchema,
  fsReadResponseSchema,
  fsWriteResponseSchema,
  fsStatResponseSchema,
  fsListResponseSchema,
  fsMkdirResponseSchema,
  processExecResponseSchema,
  processCancelResponseSchema,
]);
