import type WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { productionRunnerOperationSchema } from '@cloudcrane/workspace-protocol';
import { RunnerGatewayConnection } from './runner-gateway-connection.js';

describe('RunnerGatewayConnection idempotency', () => {
  it('replays an identical request and rejects a reused key with a different payload', async () => {
    const handler = { execute: vi.fn().mockResolvedValue({ item: { id: '7' } }) };
    const connection = new RunnerGatewayConnection(
      { runnerId: 'runner-test' } as never,
      handler as never,
    );
    const send = vi.fn();
    const socket = { send } as unknown as WebSocket;
    const operation = productionRunnerOperationSchema.parse({
      type: 'production.operation',
      operation: 'cms.content.create',
      requestId: '00000000-0000-4000-8000-000000000041',
      traceId: '00000000-0000-4000-8000-000000000042',
      websiteId: '00000000-0000-4000-8000-000000000043',
      workspaceId: '00000000-0000-4000-8000-000000000044',
      deadlineMs: 120_000,
      idempotencyKey: 'create-key-1',
      payload: { categoryCode: 'news01', title: 'First title' },
    });
    const invoke = (
      connection as unknown as {
        handleOperation(socket: WebSocket, operation: unknown): Promise<void>;
      }
    ).handleOperation.bind(connection);

    await invoke(socket, operation);
    await invoke(socket, { ...operation, requestId: '00000000-0000-4000-8000-000000000045' });
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[1]![0] as string)).toMatchObject({
      type: 'runner.completed',
      result: { item: { id: '7' } },
    });

    await invoke(socket, {
      ...operation,
      requestId: '00000000-0000-4000-8000-000000000046',
      payload: { categoryCode: 'news01', title: 'Different title' },
    });
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[3]![0] as string)).toMatchObject({
      type: 'runner.error',
      error: { code: 'IDEMPOTENCY_KEY_REUSED' },
      outcome: 'FAILED',
    });
  });
});
