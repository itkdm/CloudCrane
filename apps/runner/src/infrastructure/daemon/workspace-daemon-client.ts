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
    this.name = 'WorkspaceDaemonClientError';
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
  exec(request: ProcessExecRequest, timeoutMs?: number) {
    return this.post(
      '/v1/process/exec',
      request,
      processExecResponseSchema,
      timeoutMs ?? Math.max(this.timeoutMs, request.timeoutMs + 2_000),
    );
  }
  cancel(executionId: string) {
    return this.post('/v1/process/cancel', { executionId }, processCancelResponseSchema);
  }

  private async get<T>(path: string, schema?: z.ZodType<T>): Promise<T> {
    return this.request('GET', path, undefined, schema);
  }

  private async post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    return this.request('POST', path, body, schema, timeoutMs);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const requestId = randomUUID();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort('deadline exceeded');
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.endpoint}${path}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-request-id': requestId },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (timedOut)
          throw new WorkspaceDaemonClientError(
            'REQUEST_TIMEOUT',
            'workspace daemon request timed out',
          );
        throw new WorkspaceDaemonClientError(
          'INTERNAL_ERROR',
          'workspace daemon connection failed',
          { cause: error instanceof Error ? error.name : 'unknown' },
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new WorkspaceDaemonClientError(
          'PROTOCOL_ERROR',
          'workspace daemon returned invalid JSON',
        );
      }
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
          'PROTOCOL_ERROR',
          'workspace daemon returned an invalid error response',
        );
      }
      if (!schema) return payload as T;
      try {
        return schema.parse(payload);
      } catch {
        throw new WorkspaceDaemonClientError(
          'PROTOCOL_ERROR',
          'workspace daemon returned an invalid response',
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
