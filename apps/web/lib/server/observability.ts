import {
  createLogger,
  createRequestId,
  getActiveTraceContext,
  runWithLogContext,
  runWithTraceContext,
  serializeError,
  withSpan,
} from '@cloudcrane/shared';

const logger = createLogger('web.http');

export function withWebRequestContext(
  request: Request,
  operation: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? createRequestId();
  const traceparent = request.headers.get('traceparent') ?? undefined;
  const startedAt = Date.now();
  return runWithLogContext({ requestId, operation }, () =>
    runWithTraceContext({ traceparent }, () =>
      withSpan(`http.server ${operation}`, { 'http.operation': operation }, async () => {
        try {
          const response = await handler();
          logger.info(
            {
              event: 'http.request.finished',
              operation,
              statusCode: response.status,
              durationMs: Date.now() - startedAt,
              outcome: response.status >= 500 ? 'failed' : 'succeeded',
              ...getActiveTraceContext(),
            },
            'web request completed',
          );
          return response;
        } catch (error) {
          logger.error(
            {
              event: 'http.request.failed',
              operation,
              durationMs: Date.now() - startedAt,
              outcome: 'failed',
              ...getActiveTraceContext(),
              ...serializeError(error),
            },
            'web request failed',
          );
          throw error;
        }
      }),
    ),
  );
}
