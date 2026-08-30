import { z } from 'zod';

export const remoteErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'WORKSPACE_NOT_FOUND',
  'WEBSITE_WORKSPACE_MISMATCH',
  'RUNNER_UNAVAILABLE',
  'RUNNER_NOT_REGISTERED',
  'RUNNER_CAPABILITY_MISSING',
  'REQUEST_TIMEOUT',
  'PROTOCOL_ERROR',
  'UNKNOWN_RESULT',
  'INVALID_ARGUMENT',
  'INTERNAL_ERROR',
  'PATH_OUT_OF_SCOPE',
  'FILE_NOT_FOUND',
  'FILE_CHANGED',
  'PROCESS_TIMEOUT',
  'PROCESS_ABORTED',
  'OUTPUT_TRUNCATED',
]);

export const remoteErrorSchema = z.object({
  code: remoteErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type RemoteError = z.infer<typeof remoteErrorSchema>;
