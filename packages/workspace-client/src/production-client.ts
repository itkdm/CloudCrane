import { randomUUID } from 'node:crypto';
import { getLogContext, injectTraceparent } from '@cloudcrane/shared';
import {
  isProductionMutationOperation,
  productionClientOperationSchema,
  productionOperationResultSchemas,
  remoteErrorSchema,
  type ProductionOperationName,
  type ProductionOperationResult,
} from '@cloudcrane/workspace-protocol';

export type ProductionClientContext = {
  websiteId: string;
  workspaceId: string;
  traceId?: string;
  agentRunId?: string;
};
export type ProductionRequestOptions = {
  deadlineMs?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
};
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ContextProvider = () => ProductionClientContext;

export class ProductionClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProductionClientError';
  }
}

export class ProductionClient {
  private readonly fetcher: FetchLike;

  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly context: ProductionClientContext,
    fetcher?: FetchLike,
    private readonly contextProvider?: ContextProvider,
  ) {
    this.fetcher = fetcher ?? fetch;
  }

  stageRelease(
    payload: {
      artifactStorageKey: string;
      releaseId: string;
      sourcePbootVersion: string;
      sourceCoreCommit: string;
      dbSchemaVersion: string;
      sourceGitHead: string | null;
      sourceGitDirty: boolean;
      firstPublish: boolean;
    },
    options?: ProductionRequestOptions,
  ) {
    return this.call('release.stage', payload, options);
  }

  ensureRuntime(payload: { productionSlug: string }, options?: ProductionRequestOptions) {
    return this.call('production.ensure', payload, options);
  }

  deployRelease(
    payload: {
      releaseId: string;
      artifactStorageKey: string;
      artifactSha256: string;
      artifactSize: number;
      firstPublish: boolean;
    },
    options?: ProductionRequestOptions,
  ) {
    return this.call('production.deploy', payload, options);
  }

  status(options?: ProductionRequestOptions) {
    return this.call('production.status', {}, options);
  }

  authorize(payload: { authorizationCode: string }, options?: ProductionRequestOptions) {
    return this.call('production.authorize', payload, options);
  }

  destroy(options?: ProductionRequestOptions) {
    return this.call('production.destroy', {}, options);
  }

  private async call<K extends ProductionOperationName>(
    operation: K,
    payload: Record<string, unknown>,
    options: ProductionRequestOptions = {},
  ): Promise<ProductionOperationResult<K>> {
    const context = this.contextProvider?.() ?? this.context;
    const deadlineMs = options.deadlineMs ?? 120_000;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      'content-type': 'application/json',
    };
    injectTraceparent(headers);
    const body = productionClientOperationSchema.parse({
      operation,
      payload,
      requestId: randomUUID(),
      traceId: context.traceId ?? randomUUID(),
      websiteId: context.websiteId,
      workspaceId: context.workspaceId,
      agentRunId: context.agentRunId,
      toolCallId: getLogContext().toolCallId,
      traceparent: headers.traceparent,
      deadlineMs,
      idempotencyKey: options.idempotencyKey,
    });
    const controller = new AbortController();
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
          `${this.endpoint}/v1/production/websites/${context.websiteId}/operations`,
          { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal },
        );
      } catch (error) {
        if (timedOut && isProductionMutationOperation(operation))
          throw this.unknownResult('Production Gateway mutation outcome is unknown');
        if (timedOut)
          throw new ProductionClientError(
            'REQUEST_TIMEOUT',
            'Production Gateway request timed out',
          );
        if (options.signal?.aborted)
          throw new ProductionClientError('ABORTED', 'Production Gateway request was aborted');
        if (transportAttempted && isProductionMutationOperation(operation))
          throw this.unknownResult('Production Gateway mutation outcome is unknown');
        throw new ProductionClientError('INTERNAL_ERROR', 'Production Gateway connection failed', {
          cause: error instanceof Error ? error.name : 'unknown',
        });
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (isProductionMutationOperation(operation))
          throw this.unknownResult(
            'Production Gateway mutation outcome is unknown',
            response.status,
          );
        throw new ProductionClientError(
          'PROTOCOL_ERROR',
          'Production Gateway returned invalid JSON',
        );
      }
      if (!response.ok) {
        const remote =
          json && typeof json === 'object' && 'error' in json
            ? remoteErrorSchema.safeParse((json as { error?: unknown }).error)
            : undefined;
        if (!remote?.success) {
          if (isProductionMutationOperation(operation))
            throw this.unknownResult(
              'Production Gateway mutation outcome is unknown',
              response.status,
            );
          throw new ProductionClientError(
            'PROTOCOL_ERROR',
            'Production Gateway returned an invalid error response',
            undefined,
            response.status,
          );
        }
        throw new ProductionClientError(
          remote.data.code,
          remote.data.message,
          remote.data.details,
          response.status,
        );
      }
      if (!json || typeof json !== 'object' || !('result' in json)) {
        if (isProductionMutationOperation(operation))
          throw this.unknownResult('Production Gateway mutation outcome is unknown');
        throw new ProductionClientError(
          'PROTOCOL_ERROR',
          'Production Gateway response has no result',
        );
      }
      try {
        return productionOperationResultSchemas[operation].parse(
          (json as { result: unknown }).result,
        ) as ProductionOperationResult<K>;
      } catch {
        if (isProductionMutationOperation(operation))
          throw this.unknownResult('Production Gateway mutation outcome is unknown');
        throw new ProductionClientError(
          'PROTOCOL_ERROR',
          `Production Gateway returned an invalid ${operation} result`,
        );
      }
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private unknownResult(message: string, status?: number) {
    return new ProductionClientError('UNKNOWN_RESULT', message, undefined, status);
  }
}
