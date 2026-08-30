import WebSocket from 'ws';
import { createLogger } from '@cloudcrane/shared';
import {
  remoteErrorCodeSchema,
  runnerOperationSchema,
  runnerRegisteredSchema,
  type RemoteError,
  type RunnerOperation,
} from '@cloudcrane/workspace-protocol';
import type { RunnerConfig } from '../../config.js';
import { WorkspaceOperationHandler } from './workspace-operation-handler.js';
import { WorkspaceDaemonClientError } from '../daemon/workspace-daemon-client.js';

const logger = createLogger('runner-gateway-connection');
const capabilities = [
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
];

export class RunnerGatewayConnection {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectTimer?: NodeJS.Timeout;
  private attempt = 0;
  private readonly completed = new Map<string, { result: unknown; at: number }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

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
          capabilities,
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
      logger.warn({ error: String(error) }, 'runner operation failed');
    }
  }

  private async handleOperation(socket: WebSocket, operation: RunnerOperation) {
    const idempotencyKey = operation.idempotencyKey
      ? `${operation.workspaceId}:${operation.operation}:${operation.idempotencyKey}`
      : undefined;
    const cached = idempotencyKey ? this.completed.get(idempotencyKey) : undefined;
    if (cached) return this.sendCompleted(socket, operation, cached.result, 0);
    const started = Date.now();
    socket.send(
      JSON.stringify({
        type: 'runner.accepted',
        requestId: operation.requestId,
        traceId: operation.traceId,
      }),
    );
    try {
      if (Date.now() - started > operation.deadlineMs) throw new Error('deadline exceeded');
      let execution = idempotencyKey ? this.inFlight.get(idempotencyKey) : undefined;
      if (!execution) {
        execution = this.handler.execute(operation);
        if (idempotencyKey) this.inFlight.set(idempotencyKey, execution);
      }
      const result = await execution;
      if (idempotencyKey) {
        this.completed.set(idempotencyKey, { result, at: Date.now() });
        for (const [key, value] of this.completed)
          if (Date.now() - value.at > 300_000) this.completed.delete(key);
        while (this.completed.size > 1_000)
          this.completed.delete(this.completed.keys().next().value as string);
      }
      this.sendCompleted(socket, operation, result, Date.now() - started);
    } catch (error) {
      const remote = toRemoteError(error);
      socket.send(
        JSON.stringify({
          type: 'runner.error',
          requestId: operation.requestId,
          traceId: operation.traceId,
          error: remote,
          durationMs: Date.now() - started,
          outcome: 'FAILED',
        }),
      );
    } finally {
      if (idempotencyKey) this.inFlight.delete(idempotencyKey);
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
  private scheduleReconnect() {
    const delay = Math.min(30_000, 500 * 2 ** this.attempt++) + Math.floor(Math.random() * 250);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

function toRemoteError(error: unknown): RemoteError {
  const code = error instanceof WorkspaceDaemonClientError ? error.code : undefined;
  const parsedCode = code ? remoteErrorCodeSchema.safeParse(code) : undefined;
  if (parsedCode?.success) {
    return {
      code: parsedCode.data,
      message: error instanceof Error ? error.message : 'operation failed',
      ...(error instanceof WorkspaceDaemonClientError && error.details
        ? { details: error.details }
        : {}),
    };
  }
  if (error instanceof Error && error.message === 'deadline exceeded')
    return { code: 'REQUEST_TIMEOUT', message: 'runner operation deadline exceeded' };
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'operation failed',
  };
}
