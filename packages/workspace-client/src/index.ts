import { randomUUID } from 'node:crypto';
import {
  clientOperationSchema,
  operationResultSchemaFor,
  isMutationOperation,
  type OperationResult,
  type WorkspaceOperationName,
  remoteErrorSchema,
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
export type RequestOptions = {
  deadlineMs?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
};
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type WorkspaceClientContextProvider = () => WorkspaceClientContext;

export class WorkspaceClient {
  readonly runtime = {
    create: (options?: RequestOptions) => this.call('runtime.create', {}, options),
    start: (options?: RequestOptions) => this.call('runtime.start', {}, options),
    stop: (options?: RequestOptions) => this.call('runtime.stop', {}, options),
    status: (options?: RequestOptions) => this.call('runtime.status', {}, options),
    destroy: (options?: RequestOptions) => this.call('runtime.destroy', {}, options),
    info: (options?: RequestOptions) => this.call('runtime.info', {}, options),
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
    private readonly contextProvider?: WorkspaceClientContextProvider,
  ) {
    this.fetcher = fetcher ?? fetch;
  }

  private getContext(): WorkspaceClientContext {
    return this.contextProvider?.() ?? this.context;
  }

  private async call<K extends WorkspaceOperationName>(
    operation: K,
    payload: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<OperationResult<K>> {
    const context = this.getContext();
    const body = clientOperationSchema.parse({
      operation,
      payload,
      requestId: randomUUID(),
      traceId: context.traceId ?? randomUUID(),
      websiteId: context.websiteId,
      workspaceId: context.workspaceId,
      agentRunId: context.agentRunId,
      deadlineMs: options.deadlineMs ?? 120_000,
      idempotencyKey: options.idempotencyKey,
    });
    const controller = new AbortController();
    const deadlineMs = options.deadlineMs ?? 120_000;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort('deadline exceeded');
    }, deadlineMs);
    const forwardAbort = () => controller.abort(options.signal?.reason ?? 'aborted');
    if (options.signal?.aborted) forwardAbort();
    else options.signal?.addEventListener('abort', forwardAbort, { once: true });
    let transportAttempted = false;
    try {
      let response: Response;
      try {
        transportAttempted = true;
        response = await this.fetcher(
          `${this.endpoint}/v1/workspaces/${context.workspaceId}/operations`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (timedOut && isMutationOperation(operation))
          throw new WorkspaceClientError(
            'UNKNOWN_RESULT',
            'workspace gateway mutation outcome is unknown',
          );
        if (timedOut)
          throw new WorkspaceClientError('REQUEST_TIMEOUT', 'workspace gateway request timed out');
        if (options.signal?.aborted)
          throw new WorkspaceClientError('ABORTED', 'workspace gateway request was aborted');
        if (transportAttempted && isMutationOperation(operation))
          throw new WorkspaceClientError(
            'UNKNOWN_RESULT',
            'workspace gateway mutation outcome is unknown',
            {
              cause: error instanceof Error ? error.name : 'unknown',
            },
          );
        throw new WorkspaceClientError('INTERNAL_ERROR', 'workspace gateway connection failed', {
          cause: error instanceof Error ? error.name : 'unknown',
        });
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (timedOut && isMutationOperation(operation))
          throw new WorkspaceClientError(
            'UNKNOWN_RESULT',
            'workspace gateway mutation outcome is unknown',
          );
        if (timedOut)
          throw new WorkspaceClientError('REQUEST_TIMEOUT', 'workspace gateway request timed out');
        if (options.signal?.aborted)
          throw new WorkspaceClientError('ABORTED', 'workspace gateway request was aborted');
        if (transportAttempted && isMutationOperation(operation))
          throw new WorkspaceClientError(
            'UNKNOWN_RESULT',
            'workspace gateway mutation outcome is unknown',
          );
        throw new WorkspaceClientError('PROTOCOL_ERROR', 'workspace gateway returned invalid JSON');
      }
      if (!response.ok) {
        const error =
          json && typeof json === 'object' && 'error' in json
            ? remoteErrorSchema.safeParse((json as { error?: unknown }).error)
            : undefined;
        if (!error || !error.success) {
          if (isMutationOperation(operation))
            throw new WorkspaceClientError(
              'UNKNOWN_RESULT',
              'workspace gateway mutation outcome is unknown',
              undefined,
              response.status,
            );
          throw new WorkspaceClientError(
            'PROTOCOL_ERROR',
            `workspace gateway returned invalid error response (${response.status})`,
            undefined,
            response.status,
          );
        }
        throw new WorkspaceClientError(
          error.data.code,
          error.data.message,
          error.data.details,
          response.status,
        );
      }
      if (!json || typeof json !== 'object' || !('result' in json)) {
        if (isMutationOperation(operation))
          throw new WorkspaceClientError(
            'UNKNOWN_RESULT',
            'workspace gateway mutation outcome is unknown',
          );
        throw new WorkspaceClientError(
          'PROTOCOL_ERROR',
          'workspace gateway response has no result',
        );
      }
      try {
        return operationResultSchemaFor(operation).parse(
          (json as { result: unknown }).result,
        ) as OperationResult<K>;
      } catch {
        if (isMutationOperation(operation))
          throw new WorkspaceClientError(
            'UNKNOWN_RESULT',
            'workspace gateway mutation outcome is unknown',
          );
        throw new WorkspaceClientError(
          'PROTOCOL_ERROR',
          `workspace gateway returned an invalid ${operation} result`,
        );
      }
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }
}
