import { describe, expect, it, vi } from 'vitest';
import { ProductionClient, ProductionClientError } from './production-client.js';

const context = {
  websiteId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  traceId: '00000000-0000-4000-8000-000000000003',
};

describe('ProductionClient', () => {
  it('sends a traced idempotent mutation and validates the typed response', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          result: {
            releaseId: '00000000-0000-4000-8000-000000000004',
            sequence: 2,
            status: 'active',
            activatedAt: '2026-10-01T00:00:00.000Z',
          },
        }),
        { status: 200 },
      );
    });
    const client = new ProductionClient('http://gateway.test', 'client-token', context, fetcher);
    const result = await client.deployRelease(
      {
        releaseId: '00000000-0000-4000-8000-000000000004',
        artifactStorageKey: 'release-00000000-0000-4000-8000-000000000004.zip',
        artifactSha256: 'b'.repeat(64),
        artifactSize: 2048,
        firstPublish: false,
      },
      { idempotencyKey: 'deploy-attempt-1' },
    );

    expect(result).toMatchObject({ sequence: 2, status: 'active' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`http://gateway.test/v1/production/websites/${context.websiteId}/operations`);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer client-token');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      operation: 'production.deploy',
      websiteId: context.websiteId,
      workspaceId: context.workspaceId,
      traceId: context.traceId,
      idempotencyKey: 'deploy-attempt-1',
      deadlineMs: 120_000,
    });
  });

  it('returns the canonical remote error for a rejected operation', async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'WEBSITE_BUSY', message: 'website has an active AgentRun' },
        }),
        { status: 409 },
      );
    const client = new ProductionClient('http://gateway.test', 'client-token', context, fetcher);
    await expect(
      client.stageRelease({
        artifactStorageKey: 'release-00000000-0000-4000-8000-000000000004.zip',
        releaseId: '00000000-0000-4000-8000-000000000004',
        sourcePbootVersion: '3.2.26',
        sourceCoreCommit: '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea',
        dbSchemaVersion: '3.2.26',
        sourceGitHead: null,
        sourceGitDirty: true,
        firstPublish: false,
      }),
    ).rejects.toMatchObject({ code: 'WEBSITE_BUSY', status: 409 });
  });

  it('marks mutation transport failures unknown while status failures remain retryable', async () => {
    const fetcher = async () => {
      throw new Error('socket closed');
    };
    const client = new ProductionClient('http://gateway.test', 'client-token', context, fetcher);
    await expect(client.destroy()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    await expect(client.status()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('marks deadline expiry on an accepted mutation as unknown', async () => {
    const fetcher = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const client = new ProductionClient('http://gateway.test', 'client-token', context, fetcher);
    await expect(client.destroy({ deadlineMs: 5 })).rejects.toMatchObject({
      code: 'UNKNOWN_RESULT',
    });
  });

  it('does not echo an authorization code in client errors', async () => {
    const authorizationCode = 'private-license-value';
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'VERIFICATION_FAILED', message: 'authorization validation failed' },
        }),
        { status: 400 },
      );
    const client = new ProductionClient('http://gateway.test', 'client-token', context, fetcher);
    let failure: unknown;
    try {
      await client.authorize({ authorizationCode });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ProductionClientError);
    expect(String(failure)).not.toContain(authorizationCode);
  });
});
