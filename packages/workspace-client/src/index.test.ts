import { describe, expect, it, vi } from 'vitest';
import { WorkspaceClient, WorkspaceClientError } from './index.js';

const context = {
  websiteId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
};

describe('WorkspaceClient', () => {
  it('sends a typed operation with the client bearer token', async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer client-secret' });
      const body = JSON.parse(String(init?.body)) as {
        operation: string;
        workspaceId: string;
        payload: unknown;
      };
      expect(body).toMatchObject({
        operation: 'fs.write',
        workspaceId: context.workspaceId,
        payload: { path: 'index.php', content: 'ok' },
      });
      return new Response(JSON.stringify({ result: { sha256: 'a'.repeat(64), size: 2 } }), {
        status: 200,
      });
    });
    const client = new WorkspaceClient('http://gateway', 'client-secret', context, fetcher);
    await expect(
      client.fs.write({ path: 'index.php', content: 'ok' }, { idempotencyKey: 'write-1' }),
    ).resolves.toMatchObject({ size: 2 });
  });

  it('maps gateway errors to WorkspaceClientError', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'UNKNOWN_RESULT', message: 'result unavailable' } }),
          { status: 504 },
        ),
    );
    const client = new WorkspaceClient('http://gateway', 'client-secret', context, fetcher);
    await expect(client.runtime.stop({ idempotencyKey: 'stop-1' })).rejects.toMatchObject({
      code: 'UNKNOWN_RESULT',
      status: 504,
    } satisfies Partial<WorkspaceClientError>);
  });

  it('reports UNKNOWN_RESULT when a mutation loses its transport outcome', async () => {
    const client = new WorkspaceClient(
      'http://gateway',
      'client-secret',
      context,
      vi.fn(async () => {
        throw new TypeError('socket closed');
      }),
    );
    await expect(client.fs.write({ path: 'index.php', content: 'ok' })).rejects.toMatchObject({
      code: 'UNKNOWN_RESULT',
    });
  });

  it('keeps read-only connection failures distinguishable', async () => {
    const client = new WorkspaceClient(
      'http://gateway',
      'client-secret',
      context,
      vi.fn(async () => {
        throw new TypeError('socket closed');
      }),
    );
    await expect(client.fs.read({ path: 'index.php' })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('reports a mutation timeout as UNKNOWN_RESULT', async () => {
    const client = new WorkspaceClient(
      'http://gateway',
      'client-secret',
      context,
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          }),
      ),
    );
    await expect(
      client.fs.write({ path: 'index.php', content: 'ok' }, { deadlineMs: 5 }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
  });

  it('retains REQUEST_TIMEOUT for a read-only timeout', async () => {
    const client = new WorkspaceClient(
      'http://gateway',
      'client-secret',
      context,
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          }),
      ),
    );
    await expect(client.fs.read({ path: 'index.php' }, { deadlineMs: 5 })).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
    });
  });

  it('reports UNKNOWN_RESULT for an invalid mutation response', async () => {
    const client = new WorkspaceClient(
      'http://gateway',
      'client-secret',
      context,
      vi.fn(async () => new Response('{not-json', { status: 200 })),
    );
    await expect(
      client.process.exec({ command: 'echo', executionId: '00000000-0000-4000-8000-000000000003' }),
    ).rejects.toMatchObject({
      code: 'UNKNOWN_RESULT',
    });
  });
});
