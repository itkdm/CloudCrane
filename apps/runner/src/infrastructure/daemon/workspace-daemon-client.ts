import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  fsListResponseSchema,
  fsMkdirResponseSchema,
  fsReadResponseSchema,
  fsStatResponseSchema,
  fsWriteResponseSchema,
  processCancelResponseSchema,
  processExecResponseSchema,
  runtimeInfoSchema,
  type FsReadRequest,
  type FsWriteRequest,
  type ProcessExecRequest,
} from '@cloudcrane/workspace-protocol';

const daemonErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
const healthSchema = z.object({ service: z.string(), status: z.literal('ok') });

export class WorkspaceDaemonClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class WorkspaceDaemonClient {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs = 10_000,
  ) {}

  health() {
    return this.get('/v1/health', healthSchema);
  }
  runtimeInfo() {
    return this.get('/v1/runtime/info', runtimeInfoSchema);
  }
  read(request: FsReadRequest) {
    return this.post('/v1/fs/read', request, fsReadResponseSchema);
  }
  write(request: FsWriteRequest) {
    return this.post('/v1/fs/write', request, fsWriteResponseSchema);
  }
  stat(request: { path: string }) {
    return this.post('/v1/fs/stat', request, fsStatResponseSchema);
  }
  list(request: { path: string }) {
    return this.post('/v1/fs/list', request, fsListResponseSchema);
  }
  mkdir(request: { path: string; recursive?: boolean }) {
    return this.post('/v1/fs/mkdir', request, fsMkdirResponseSchema);
  }
  exec(request: ProcessExecRequest) {
    return this.post('/v1/process/exec', request, processExecResponseSchema);
  }
  cancel(executionId: string) {
    return this.post('/v1/process/cancel', { executionId }, processCancelResponseSchema);
  }

  private async get<T>(path: string, schema?: z.ZodType<T>): Promise<T> {
    return this.request('GET', path, undefined, schema);
  }

  private async post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.request('POST', path, body, schema);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const requestId = randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.endpoint}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const parsed = daemonErrorSchema.safeParse(payload);
        if (parsed.success) {
          throw new WorkspaceDaemonClientError(
            parsed.data.error.code,
            parsed.data.error.message,
            parsed.data.error.details,
          );
        }
        throw new WorkspaceDaemonClientError(
          'INTERNAL_ERROR',
          `Workspace daemon HTTP ${response.status}`,
        );
      }
      if (!schema) return payload as T;
      return schema.parse(payload);
    } finally {
      clearTimeout(timeout);
    }
  }
}
