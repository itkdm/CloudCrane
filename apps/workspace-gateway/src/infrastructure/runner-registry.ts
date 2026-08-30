import {
  runnerResultSchema,
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

export class RunnerRegistry {
  private readonly runners = new Map<string, ConnectedRunner>();

  register(register: RunnerRegister, socket: WebSocket): ConnectedRunner | undefined {
    const previous = this.runners.get(register.runnerId);
    this.runners.set(register.runnerId, { register, socket, lastHeartbeatAt: new Date() });
    return previous;
  }
  heartbeat(runnerId: string, at: Date) {
    const runner = this.runners.get(runnerId);
    if (runner) runner.lastHeartbeatAt = at;
  }
  unregister(runnerId: string, socket: WebSocket) {
    const runner = this.runners.get(runnerId);
    if (runner?.socket === socket) this.runners.delete(runnerId);
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
      return Promise.reject(new Error('runner unavailable'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('runner response timeout')),
        operation.deadlineMs,
      );
      const listener = (data: Buffer) => {
        try {
          const parsed = runnerResultSchema.safeParse(JSON.parse(data.toString()));
          if (!parsed.success || parsed.data.requestId !== operation.requestId) return;
          const message = parsed.data as RunnerResult;
          if (message.type === 'runner.accepted') return;
          clearTimeout(timer);
          runner.socket.off('message', listener);
          resolve(message);
        } catch {
          /* protocol errors are handled by the timeout/connection path */
        }
      };
      runner.socket.on('message', listener);
      runner.socket.send(JSON.stringify(operation), (error) => {
        if (error) {
          clearTimeout(timer);
          runner.socket.off('message', listener);
          reject(error);
        }
      });
    });
  }
}
