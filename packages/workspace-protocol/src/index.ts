import { z } from 'zod';

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

export const runtimeInfoSchema = z.object({
  service: z.literal('workspace-daemon'),
  version: z.string(),
  workspaceRoot: z.literal('/workspace'),
  user: z.string(),
  uid: z.number().int().nonnegative(),
  gid: z.number().int().nonnegative(),
  platform: z.string(),
  nodeVersion: z.string(),
});

export const fsPathSchema = z.object({ path: z.string().min(1).max(4096) });
export const fsReadRequestSchema = fsPathSchema.extend({
  maxBytes: z.number().int().positive().max(10_485_760).optional(),
});
export const fsReadResponseSchema = z.object({
  content: z.string(),
  sha256: z.string().length(64),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export const fsWriteRequestSchema = fsPathSchema.extend({
  content: z.string(),
  expectedSha256: z.string().length(64).optional(),
});
export const fsWriteResponseSchema = z.object({
  sha256: z.string().length(64),
  size: z.number().int().nonnegative(),
});
export const fsStatResponseSchema = fsPathSchema.extend({
  type: z.enum(['file', 'directory', 'symlink']),
  size: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative(),
  modifiedAt: z.string(),
});
export const fsListResponseSchema = z.object({
  path: z.string(),
  entries: z.array(fsStatResponseSchema),
});
export const fsMkdirRequestSchema = fsPathSchema.extend({ recursive: z.boolean().default(true) });
export const fsMkdirResponseSchema = z.object({ path: z.string() });

export const processExecRequestSchema = z.object({
  command: z.string().min(1).max(16_384),
  args: z.array(z.string().max(4096)).max(256).default([]),
  cwd: z.string().min(1).max(4096).default('/workspace'),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(8192)).default({}),
  timeoutMs: z.number().int().positive().max(300_000).default(120_000),
  maxOutputBytes: z.number().int().positive().max(10_485_760).default(1_048_576),
  executionId: z.string().uuid(),
});
export const processExecResponseSchema = z.object({
  executionId: z.string().uuid(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  truncated: z.boolean(),
  status: z.enum(['completed', 'timeout', 'aborted']),
});
export const processCancelRequestSchema = z.object({ executionId: z.string().uuid() });
export const processCancelResponseSchema = z.object({
  executionId: z.string().uuid(),
  cancelled: z.boolean(),
  status: z.literal('aborted'),
});

export type RuntimeInfo = z.infer<typeof runtimeInfoSchema>;
export type FsReadRequest = z.infer<typeof fsReadRequestSchema>;
export type FsReadResponse = z.infer<typeof fsReadResponseSchema>;
export type FsWriteRequest = z.infer<typeof fsWriteRequestSchema>;
export type FsWriteResponse = z.infer<typeof fsWriteResponseSchema>;
export type FsStatResponse = z.infer<typeof fsStatResponseSchema>;
export type FsListResponse = z.infer<typeof fsListResponseSchema>;
export type FsMkdirRequest = z.infer<typeof fsMkdirRequestSchema>;
export type ProcessExecRequest = z.infer<typeof processExecRequestSchema>;
export type ProcessExecResponse = z.infer<typeof processExecResponseSchema>;
