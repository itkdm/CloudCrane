import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { RunnerOperation } from '@cloudcrane/workspace-protocol';
import { RunnerRegistry } from './runner-registry.js';

const runnerId = '00000000-0000-4000-8000-000000000301';
const operation = {
  type: 'workspace.operation',
  operation: 'fs.read',
  requestId: '00000000-0000-4000-8000-000000000302',
  traceId: '00000000-0000-4000-8000-000000000303',
  websiteId: '00000000-0000-4000-8000-000000000304',
  workspaceId: '00000000-0000-4000-8000-000000000305',
  deadlineMs: 1_000,
  payload: { path: '/workspace/index.php' },
} satisfies RunnerOperation;

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];

  send(value: string, callback?: (error?: Error) => void) {
    this.sent.push(value);
    callback?.();
  }
}

function register(registry: RunnerRegistry, socket: FakeSocket, id = runnerId) {
  registry.register(
    {
      type: 'runner.register',
      runnerId: id,
      name: 'test-runner',
      version: 'test',
      capabilities: ['fs.read'],
    },
    socket as never,
  );
}

describe('RunnerRegistry', () => {
  it('cleans pending dispatches on close and marks accepted mutations unknown', async () => {
    const registry = new RunnerRegistry();
    const socket = new FakeSocket();
    register(registry, socket);
    const mutation = {
      ...operation,
      operation: 'fs.write',
      payload: { path: '/workspace/index.php', content: 'x' },
    } as RunnerOperation;
    const pending = registry.dispatch(runnerId, mutation);
    socket.emit(
      'message',
      JSON.stringify({
        type: 'runner.accepted',
        requestId: mutation.requestId,
        traceId: mutation.traceId,
      }),
    );
    expect(() => registry.unregister(runnerId, socket as never)).not.toThrow();
    await expect(pending).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', accepted: true });
    expect(registry.online(runnerId)).toBe(false);
  });

  it('does not let an old socket close take a replacement offline', () => {
    const registry = new RunnerRegistry();
    const oldSocket = new FakeSocket();
    const newSocket = new FakeSocket();
    register(registry, oldSocket);
    register(registry, newSocket);
    expect(registry.unregister(runnerId, oldSocket as never)).toBe(false);
    expect(registry.get(runnerId)?.socket).toBe(newSocket);
    expect(registry.online(runnerId)).toBe(true);
  });
});
