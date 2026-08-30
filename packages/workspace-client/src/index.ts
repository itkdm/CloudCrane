import { randomUUID } from 'node:crypto';
import {
  clientOperationSchema,
  operationResultSchema,
  type ClientOperation,
  type RuntimeInfo,
} from '@cloudcrane/workspace-protocol';

export type WorkspaceClientContext = {
  websiteId: string;
  workspaceId: string;
  traceId?: string;
  agentRunId?: string;
};
export class WorkspaceClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'WorkspaceClientError';
  }
}
type RequestOptions = { deadlineMs?: number; idempotencyKey?: string };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class WorkspaceClient {
  readonly runtime = {
    create: (options?: RequestOptions) => this.call('runtime.create', {}, options),
    start: (options?: RequestOptions) => this.call('runtime.start', {}, options),
    stop: (options?: RequestOptions) => this.call('runtime.stop', {}, options),
    status: (options?: RequestOptions) => this.call('runtime.status', {}, options),
    destroy: (options?: RequestOptions) => this.call('runtime.destroy', {}, options),
    info: (options?: RequestOptions) =>
      this.call('runtime.info', {}, options) as Promise<RuntimeInfo>,
  };
  readonly fs = {
    read: (payload: { path: string; maxBytes?: number }, options?: RequestOptions) =>
      this.call('fs.read', payload, options),
    write: (
      payload: { path: string; content: string; expectedSha256?: string },
      options?: RequestOptions,
    ) => this.call('fs.write', payload, options),
    stat: (payload: { path: string }, options?: RequestOptions) =>
      this.call('fs.stat', payload, options),
    list: (payload: { path: string }, options?: RequestOptions) =>
      this.call('fs.list', payload, options),
    mkdir: (payload: { path: string; recursive?: boolean }, options?: RequestOptions) =>
      this.call('fs.mkdir', payload, options),
  };
  readonly process = {
    exec: (
      payload: {
        command: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
        timeoutMs?: number;
        maxOutputBytes?: number;
        executionId: string;
      },
      options?: RequestOptions,
    ) => this.call('process.exec', payload, options),
    cancel: (payload: { executionId: string }, options?: RequestOptions) =>
      this.call('process.cancel', payload, options),
  };

  private readonly fetcher: FetchLike;
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly context: WorkspaceClientContext,
    fetcher?: FetchLike,
  ) {
    this.fetcher = fetcher ?? fetch;
  }

  private async call(
    operation: ClientOperation['operation'],
    payload: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const body = clientOperationSchema.parse({
      operation,
      payload,
      requestId: randomUUID(),
      traceId: this.context.traceId ?? randomUUID(),
      websiteId: this.context.websiteId,
      workspaceId: this.context.workspaceId,
      agentRunId: this.context.agentRunId,
      deadlineMs: options.deadlineMs ?? 120_000,
      idempotencyKey: options.idempotencyKey,
    });
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.endpoint}/v1/workspaces/${this.context.workspaceId}/operations`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    } catch (error) {
      throw new WorkspaceClientError(
        'REQUEST_TIMEOUT',
        error instanceof Error ? error.message : 'workspace gateway request failed',
      );
    }
    const json: unknown = await response.json();
    if (!response.ok) {
      const error =
        json && typeof json === 'object' && 'error' in json
          ? (
              json as {
                error?: { code?: string; message?: string; details?: Record<string, unknown> };
              }
            ).error
          : undefined;
      throw new WorkspaceClientError(
        error?.code ?? 'INTERNAL_ERROR',
        error?.message ?? `workspace gateway HTTP ${response.status}`,
        error?.details,
        response.status,
      );
    }
    const result =
      json && typeof json === 'object' && 'result' in json
        ? (json as { result: unknown }).result
        : undefined;
    return operationResultSchema.parse(result);
  }
}
