import {
  isMutationOperation,
  runnerResultSchema,
  type RemoteError,
  type RunnerOperation,
  type RunnerRegister,
  type RunnerResult,
} from '@cloudcrane/workspace-protocol';
import type { WebSocket } from 'ws';

export type ConnectedRunner = {
  register: RunnerRegister;
  socket: WebSocket;
  lastHeartbeatAt: Date;
};

type PendingDispatch = {
  operation: RunnerOperation;
  resolve: (result: RunnerResult) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  accepted: boolean;
};

export class RunnerDispatchError extends Error {
  constructor(
    public readonly code: RemoteError['code'],
    message: string,
    public readonly accepted: boolean,
  ) {
    super(message);
    this.name = 'RunnerDispatchError';
  }
}

export class RunnerRegistry {
  private readonly runners = new Map<string, ConnectedRunner>();
  private readonly pending = new Map<WebSocket, Map<string, PendingDispatch>>();

  register(register: RunnerRegister, socket: WebSocket): ConnectedRunner | undefined {
    const previous = this.runners.get(register.runnerId);
    if (previous)
      this.failPending(previous.socket, 'RUNNER_UNAVAILABLE', 'runner connection replaced');
    const connected = { register, socket, lastHeartbeatAt: new Date() };
    this.runners.set(register.runnerId, connected);
    this.pending.set(socket, new Map());
    socket.on('message', (raw) => this.handleMessage(socket, raw.toString()));
    return previous;
  }

  heartbeat(runnerId: string, at: Date) {
    const runner = this.runners.get(runnerId);
    if (runner) runner.lastHeartbeatAt = at;
  }

  unregister(runnerId: string, socket: WebSocket): boolean {
    const runner = this.runners.get(runnerId);
    if (!runner || runner.socket !== socket) return false;
    this.runners.delete(runnerId);
    this.failPending(socket, 'RUNNER_UNAVAILABLE', 'runner connection closed');
    return true;
  }

  get(runnerId: string) {
    return this.runners.get(runnerId);
  }

  online(runnerId: string) {
    return this.runners.has(runnerId);
  }

  staleBefore(cutoff: Date): string[] {
    return [...this.runners.entries()]
      .filter(([, runner]) => runner.lastHeartbeatAt < cutoff)
      .map(([runnerId]) => runnerId);
  }

  dispatch(runnerId: string, operation: RunnerOperation): Promise<RunnerResult> {
    const runner = this.runners.get(runnerId);
    if (!runner || runner.socket.readyState !== 1)
      return Promise.reject(
        new RunnerDispatchError('RUNNER_UNAVAILABLE', 'runner unavailable', false),
      );
    const pendingForSocket = this.pending.get(runner.socket) ?? new Map<string, PendingDispatch>();
    this.pending.set(runner.socket, pendingForSocket);
    return new Promise((resolve, reject) => {
      const pending: PendingDispatch = {
        operation,
        resolve,
        reject,
        accepted: false,
        timer: setTimeout(() => {
          pendingForSocket.delete(operation.requestId);
          reject(
            new RunnerDispatchError(
              isMutationOperation(operation.operation) ? 'UNKNOWN_RESULT' : 'REQUEST_TIMEOUT',
              'runner response timed out',
              pending.accepted,
            ),
          );
        }, operation.deadlineMs),
      };
      pendingForSocket.set(operation.requestId, pending);
      runner.socket.send(JSON.stringify(operation), (error) => {
        if (!error) return;
        this.removePending(runner.socket, operation.requestId);
        reject(
          new RunnerDispatchError('RUNNER_UNAVAILABLE', 'runner dispatch failed', pending.accepted),
        );
      });
    });
  }

  private handleMessage(socket: WebSocket, raw: string) {
    let parsed: ReturnType<typeof runnerResultSchema.safeParse>;
    try {
      parsed = runnerResultSchema.safeParse(JSON.parse(raw));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const message = parsed.data;
    const pendingForSocket = this.pending.get(socket);
    const pending = pendingForSocket?.get(message.requestId);
    if (!pending) return;
    if (message.type === 'runner.accepted') {
      pending.accepted = true;
      return;
    }
    this.removePending(socket, message.requestId);
    pending.resolve(message);
  }

  private removePending(socket: WebSocket, requestId: string) {
    const pendingForSocket = this.pending.get(socket);
    const pending = pendingForSocket?.get(requestId);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    pendingForSocket?.delete(requestId);
    return pending;
  }

  private failPending(socket: WebSocket, fallbackCode: RemoteError['code'], message: string) {
    const pendingForSocket = this.pending.get(socket);
    if (!pendingForSocket) return;
    for (const [requestId, pending] of pendingForSocket) {
      clearTimeout(pending.timer);
      pending.reject(
        new RunnerDispatchError(
          isMutationOperation(pending.operation.operation) ? 'UNKNOWN_RESULT' : fallbackCode,
          message,
          pending.accepted,
        ),
      );
      pendingForSocket.delete(requestId);
    }
    this.pending.delete(socket);
  }
}
