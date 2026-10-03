import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import {
  createLogger,
  createSpanId,
  createTraceId,
  runWithLogContext,
  runWithTraceContext,
  sanitizeText,
  serializeError,
  withSpan,
} from '@cloudcrane/shared';
import {
  remoteErrorCodeSchema,
  runnerOperationSchema,
  runnerRegisteredSchema,
  isRunnerMutationOperation,
  type RemoteError,
  type RunnerOperation,
} from '@cloudcrane/workspace-protocol';
import type { RunnerConfig } from '../../config.js';
import { WorkspaceOperationHandler } from './workspace-operation-handler.js';
import { WorkspaceDaemonClientError } from '../daemon/workspace-daemon-client.js';
import { toProductionRemoteError } from '../../ports/production-operation-error.js';

const logger = createLogger('runner-gateway-connection');
const workspaceCapabilities = [
  'runtime.create',
  'runtime.start',
  'runtime.stop',
  'runtime.status',
  'runtime.destroy',
  'runtime.info',
  'fs.read',
  'fs.write',
  'fs.stat',
  'fs.list',
  'fs.mkdir',
  'process.exec',
  'process.cancel',
  'snapshot.stage',
];
export class RunnerGatewayConnection {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectTimer?: NodeJS.Timeout;
  private attempt = 0;
  private readonly completed = new Map<
    string,
    { result: unknown; fingerprint: string; at: number }
  >();
  private readonly inFlight = new Map<
    string,
    { execution: Promise<unknown>; fingerprint: string }
  >();

  constructor(
    private readonly config: RunnerConfig,
    private readonly handler: WorkspaceOperationHandler,
  ) {}
  start() {
    if (this.config.gatewayUrl && this.config.runnerAuthToken) this.connect();
  }
  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  private connect() {
    if (this.stopped || !this.config.gatewayUrl || !this.config.runnerAuthToken) return;
    const socket = new WebSocket(this.config.gatewayUrl, {
      headers: { authorization: `Bearer ${this.config.runnerAuthToken}` },
    });
    this.socket = socket;
    socket.once('open', () => {
      this.attempt = 0;
      socket.send(
        JSON.stringify({
          type: 'runner.register',
          runnerId: this.config.runnerId,
          name: `runner-${this.config.runnerId.slice(0, 8)}`,
          version: '0.1.0',
          capabilities: [...workspaceCapabilities, ...this.handler.productionCapabilities()],
        }),
      );
    });
    socket.on('message', (raw) => void this.onMessage(socket, raw.toString()));
    socket.once('close', () => {
      if (!this.stopped) this.scheduleReconnect();
    });
    socket.once('error', () => {
      /* close drives reconnect and avoids logging auth/token details */
    });
  }

  private async onMessage(socket: WebSocket, raw: string) {
    try {
      const data = JSON.parse(raw) as { type?: string };
      if (data.type === 'runner.registered') {
        const registered = runnerRegisteredSchema.parse(data);
        const timer = setInterval(
          () =>
            socket.readyState === 1 &&
            socket.send(
              JSON.stringify({
                type: 'runner.heartbeat',
                runnerId: registered.runnerId,
                timestamp: new Date().toISOString(),
              }),
            ),
          registered.heartbeatIntervalMs,
        );
        socket.once('close', () => clearInterval(timer));
        return;
      }
      const operation = runnerOperationSchema.safeParse(data);
      if (!operation.success) return socket.close(4002, 'invalid operation');
      await this.handleOperation(socket, operation.data);
    } catch (error) {
      logger.warn(
        { event: 'workspace.operation.rejected', ...serializeError(error) },
        'runner operation rejected',
      );
    }
  }

  private async handleOperation(socket: WebSocket, operation: RunnerOperation) {
    const idempotencyKey = operation.idempotencyKey
      ? `${operation.websiteId}:${operation.workspaceId}:${operation.operation}:${operation.idempotencyKey}`
      : undefined;
    const fingerprint = requestFingerprint(operation);
    const cached = idempotencyKey ? this.completed.get(idempotencyKey) : undefined;
    if (cached) {
      if (cached.fingerprint !== fingerprint)
        return this.sendIdempotencyConflict(socket, operation);
      return this.sendCompleted(socket, operation, cached.result, 0);
    }
    const existing = idempotencyKey ? this.inFlight.get(idempotencyKey) : undefined;
    if (existing && existing.fingerprint !== fingerprint)
      return this.sendIdempotencyConflict(socket, operation);
    const started = Date.now();
    logger.info(
      {
        event: 'workspace.operation.started',
        requestId: operation.requestId,
        runCorrelationId: operation.traceId,
        websiteId: operation.websiteId,
        workspaceId: operation.workspaceId,
        agentRunId: operation.agentRunId,
        runnerId: this.config.runnerId,
        operation: operation.operation,
      },
      'runner operation started',
    );
    socket.send(
      JSON.stringify({
        type: 'runner.accepted',
        requestId: operation.requestId,
        traceId: operation.traceId,
      }),
    );
    try {
      if (Date.now() - started > operation.deadlineMs) throw new Error('deadline exceeded');
      let pending = idempotencyKey ? this.inFlight.get(idempotencyKey) : undefined;
      if (!pending) {
        const execution = runWithLogContext(
          {
            requestId: operation.requestId,
            runCorrelationId: operation.traceId,
            traceId: createTraceId(),
            spanId: createSpanId(),
            websiteId: operation.websiteId,
            workspaceId: operation.workspaceId,
            agentRunId: operation.agentRunId,
            runnerId: this.config.runnerId,
            operation: operation.operation,
          },
          () =>
            runWithTraceContext({ traceparent: operation.traceparent }, () =>
              withSpan(
                'runner.operation',
                {
                  'cloudcrane.operation': operation.operation,
                  'cloudcrane.website_id': operation.websiteId,
                  'cloudcrane.workspace_id': operation.workspaceId,
                  'cloudcrane.agent_run_id': operation.agentRunId,
                  'cloudcrane.runner_id': this.config.runnerId,
                },
                () => this.handler.execute(operation),
              ),
            ),
        );
        pending = { execution, fingerprint };
        if (idempotencyKey) this.inFlight.set(idempotencyKey, pending);
      }
      if (!pending) throw new Error('runner operation execution was not initialized');
      const result = await pending.execution;
      if (idempotencyKey) {
        this.completed.set(idempotencyKey, { result, fingerprint, at: Date.now() });
        for (const [key, value] of this.completed)
          if (Date.now() - value.at > 300_000) this.completed.delete(key);
        while (this.completed.size > 1_000)
          this.completed.delete(this.completed.keys().next().value as string);
      }
      logger.info(
        {
          event: 'workspace.operation.finished',
          requestId: operation.requestId,
          runCorrelationId: operation.traceId,
          websiteId: operation.websiteId,
          workspaceId: operation.workspaceId,
          agentRunId: operation.agentRunId,
          runnerId: this.config.runnerId,
          operation: operation.operation,
          durationMs: Date.now() - started,
          outcome: 'succeeded',
        },
        'runner operation completed',
      );
      this.sendCompleted(socket, operation, result, Date.now() - started);
    } catch (error) {
      const remote = toRemoteError(error);
      logger.warn(
        {
          event: 'workspace.operation.finished',
          requestId: operation.requestId,
          runCorrelationId: operation.traceId,
          websiteId: operation.websiteId,
          workspaceId: operation.workspaceId,
          agentRunId: operation.agentRunId,
          runnerId: this.config.runnerId,
          operation: operation.operation,
          durationMs: Date.now() - started,
          outcome:
            remote.code === 'UNKNOWN_RESULT' ||
            (remote.code === 'REQUEST_TIMEOUT' && isRunnerMutationOperation(operation))
              ? 'unknown'
              : 'failed',
          errorCode: remote.code,
        },
        'runner operation failed',
      );
      socket.send(
        JSON.stringify({
          type: 'runner.error',
          requestId: operation.requestId,
          traceId: operation.traceId,
          error: remote,
          durationMs: Date.now() - started,
          outcome:
            remote.code === 'UNKNOWN_RESULT' ||
            (remote.code === 'REQUEST_TIMEOUT' && isRunnerMutationOperation(operation))
              ? 'UNKNOWN'
              : 'FAILED',
        }),
      );
    } finally {
      if (idempotencyKey && this.inFlight.get(idempotencyKey)?.fingerprint === fingerprint)
        this.inFlight.delete(idempotencyKey);
    }
  }
  private sendCompleted(
    socket: WebSocket,
    operation: RunnerOperation,
    result: unknown,
    durationMs: number,
  ) {
    socket.send(
      JSON.stringify({
        type: 'runner.completed',
        requestId: operation.requestId,
        traceId: operation.traceId,
        result,
        durationMs,
      }),
    );
  }
  private sendIdempotencyConflict(socket: WebSocket, operation: RunnerOperation) {
    socket.send(
      JSON.stringify({
        type: 'runner.error',
        requestId: operation.requestId,
        traceId: operation.traceId,
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'idempotency key was used with a different request',
        },
        durationMs: 0,
        outcome: 'FAILED',
      }),
    );
  }
  private scheduleReconnect() {
    const delay = Math.min(30_000, 500 * 2 ** this.attempt++) + Math.floor(Math.random() * 250);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

function requestFingerprint(operation: RunnerOperation): string {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, canonicalize(entry)]),
      );
    return value;
  };
  return createHash('sha256')
    .update(
      JSON.stringify(canonicalize({ operation: operation.operation, payload: operation.payload })),
    )
    .digest('hex');
}

function toRemoteError(error: unknown): RemoteError {
  const productionError = toProductionRemoteError(error);
  if (productionError)
    return { ...productionError, message: sanitizeText(productionError.message) };
  const code = error instanceof WorkspaceDaemonClientError ? error.code : undefined;
  const parsedCode = code ? remoteErrorCodeSchema.safeParse(code) : undefined;
  if (parsedCode?.success) {
    return {
      code: parsedCode.data,
      message:
        error instanceof WorkspaceDaemonClientError
          ? `workspace operation failed (${error.code})`
          : error instanceof Error
            ? sanitizeText(error.message)
            : 'operation failed',
    };
  }
  if (error instanceof Error && error.message === 'deadline exceeded')
    return { code: 'REQUEST_TIMEOUT', message: 'runner operation deadline exceeded' };
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? sanitizeText(error.message) : 'operation failed',
  };
}
