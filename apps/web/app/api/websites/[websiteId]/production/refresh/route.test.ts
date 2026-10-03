import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, requireWebsiteAccess } = vi.hoisted(() => ({
  state: {
    operationRows: [] as Array<Record<string, unknown>>,
    filters: [] as unknown[],
    select: vi.fn(),
  },
  requireWebsiteAccess: vi.fn(),
}));

vi.mock('@cloudcrane/auth', () => ({
  AuthorizationError: class AuthorizationError extends Error {
    code = 'AUTHORIZATION_REQUIRED';
    status = 401;
  },
  assertSameOrigin: vi.fn(),
  requireWebsiteAccess,
}));

vi.mock('@cloudcrane/db', () => {
  const operation = {
    id: 'operation.id',
    status: 'operation.status',
    metadata: 'operation.metadata',
    errorCode: 'operation.errorCode',
    websiteId: 'operation.websiteId',
    type: 'operation.type',
    idempotencyKey: 'operation.idempotencyKey',
    createdAt: 'operation.createdAt',
  };
  const website = { id: 'website.id', ownerId: 'website.ownerId' };
  const query = () => {
    let table: unknown;
    return {
      from(value: unknown) {
        table = value;
        return this;
      },
      where(filter: unknown) {
        state.filters.push(filter);
        return this;
      },
      orderBy() {
        return this;
      },
      limit() {
        return Promise.resolve(table === website ? [{ id: 'website-1' }] : state.operationRows);
      },
    };
  };
  state.select.mockImplementation(query);
  return {
    agentRun: {},
    finishAuditEvent: vi.fn(),
    insertAuditEvent: vi.fn(),
    operation,
    productionRuntime: {},
    website,
    websiteRelease: {},
    workspace: {},
    authDb: { select: () => state.select() },
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: vi.fn(),
  sql: (strings: TemplateStringsArray) => strings.join(''),
}));

vi.mock('@cloudcrane/workspace-client', () => ({
  ProductionClient: class {},
  ProductionClientError: class extends Error {},
  WorkspaceClient: class {},
}));

vi.mock('@cloudcrane/shared', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  getActiveTraceContext: () => ({}),
}));

vi.mock('../../../../../../lib/server/auth.js', () => ({
  auth: {},
  authDb: { select: () => state.select() },
}));
vi.mock('../../../../../../lib/server/observability.js', () => ({
  withWebRequestContext: (_request: Request, _name: string, handler: () => Promise<Response>) =>
    handler(),
}));

import { GET } from './route.js';

function findCondition(value: unknown, column: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('column' in value && value.column === column) return true;
  if ('conditions' in value && Array.isArray(value.conditions))
    return value.conditions.some((condition) => findCondition(condition, column));
  return false;
}

describe('GET Production refresh operation status', () => {
  beforeEach(() => {
    state.operationRows = [
      {
        id: 'operation-a',
        status: 'succeeded',
        metadata: { refreshResult: { uploadFiles: 2 }, previewSynchronized: true },
        errorCode: null,
      },
    ];
    state.filters = [];
    requireWebsiteAccess.mockResolvedValue({
      isAdmin: false,
      session: { user: { id: 'user-1' } },
    });
  });

  it('looks up the operation for the provided idempotency key', async () => {
    const response = await GET(
      new Request(
        'https://app.example.test/api/websites/website-1/production/refresh?idempotencyKey=key-a',
      ),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      operationId: 'operation-a',
      status: 'succeeded',
      result: { uploadFiles: 2 },
    });
    expect(state.filters.some((filter) => findCondition(filter, 'operation.idempotencyKey'))).toBe(
      true,
    );
  });

  it('returns not_found for a persisted key whose operation no longer exists', async () => {
    state.operationRows = [];

    const response = await GET(
      new Request(
        'https://app.example.test/api/websites/website-1/production/refresh?idempotencyKey=key-old',
      ),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    );

    expect(await response.json()).toEqual({ status: 'not_found' });
  });

  it('rejects an explicitly empty idempotency key instead of looking up the latest operation', async () => {
    const response = await GET(
      new Request(
        'https://app.example.test/api/websites/website-1/production/refresh?idempotencyKey=%20',
      ),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_INVALID' },
    });
  });
});
