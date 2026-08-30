import { z } from 'zod';

export * from './daemon.js';
export * from './errors.js';
export * from './remote.js';
export * from './runner/messages.js';
export * from './workspace/operations.js';

export const envelopeSchema = z.object({
  type: z.string().min(1),
  requestId: z.string().min(1),
  websiteId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  agentRunId: z.string().min(1).optional(),
  timestamp: z.coerce.date(),
  payload: z.unknown(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

export const workspaceErrorCodeSchema = z.enum([
  'PATH_OUT_OF_SCOPE',
  'FILE_NOT_FOUND',
  'FILE_CHANGED',
  'PROCESS_TIMEOUT',
  'PROCESS_ABORTED',
  'OUTPUT_TRUNCATED',
  'INVALID_ARGUMENT',
  'INTERNAL_ERROR',
]);
export const workspaceErrorSchema = z.object({
  code: workspaceErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type WorkspaceError = z.infer<typeof workspaceErrorSchema>;
