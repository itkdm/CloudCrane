import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
}));

import { ModelProfileService } from './model-profiles.js';

function profileStore() {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
          limit: async () => rows.slice(0, 1),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          for (const row of rows) Object.assign(row, values);
          return {
            returning: async () => rows.slice(0, 1),
          };
        },
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
            ...value,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          rows.push(row);
          return [row];
        },
      }),
    }),
  };
  return { db, rows };
}

describe('ModelProfileService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores custom OpenAI-compatible models and returns their provider name without exposing keys', async () => {
    const store = profileStore();
    const service = new ModelProfileService(store as never, Buffer.alloc(32, 7).toString('base64'));
    const profile = await service.create('user-1', {
      providerKind: 'openai-compatible',
      presetId: 'custom-openai-compatible',
      providerId: 'custom',
      providerName: 'Acme AI',
      modelId: 'acme-coder-v2',
      baseUrl: 'https://llm.example.com/v1',
      api: 'openai-completions',
      apiKey: 'secret-api-key',
      input: ['text'],
      reasoning: true,
      contextWindow: 96_000,
      maxTokens: 8_192,
    });

    expect(profile).toMatchObject({
      providerName: 'Acme AI',
      modelId: 'acme-coder-v2',
      displayName: 'Acme AI/acme-coder-v2',
      input: ['text'],
      reasoning: true,
      contextWindow: 96_000,
      maxTokens: 8_192,
    });
    expect(profile).not.toHaveProperty('apiKey');
    expect(store.rows[0]).not.toHaveProperty('apiKey');
    expect(store.rows[0]?.apiKeyCiphertext).not.toBe('secret-api-key');
    await expect(service.resolve('user-1', profile.id)).resolves.toMatchObject({
      apiKey: 'secret-api-key',
    });
  });

  it('rejects loopback endpoints before storing a provider credential', async () => {
    const store = profileStore();
    const service = new ModelProfileService(store as never, Buffer.alloc(32, 7).toString('base64'));

    await expect(
      service.create('user-1', {
        providerKind: 'openai-compatible',
        presetId: 'custom-openai-compatible',
        providerId: 'custom',
        providerName: 'Local endpoint',
        modelId: 'local-model',
        baseUrl: 'https://127.0.0.1/v1',
        apiKey: 'secret-api-key',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(store.rows).toHaveLength(0);
  });

  it('rejects unsupported wire protocols for custom providers', async () => {
    const store = profileStore();
    const service = new ModelProfileService(store as never, Buffer.alloc(32, 7).toString('base64'));

    await expect(
      service.create('user-1', {
        providerKind: 'openai-compatible',
        presetId: 'custom-openai-compatible',
        providerId: 'custom',
        providerName: 'Custom endpoint',
        modelId: 'custom-model',
        baseUrl: 'https://llm.example.com/v1',
        api: 'anthropic-messages',
        apiKey: 'secret-api-key',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(store.rows).toHaveLength(0);
  });

  it('uses server-owned endpoint and API for built-in providers', async () => {
    const store = profileStore();
    const service = new ModelProfileService(store as never, Buffer.alloc(32, 7).toString('base64'));

    const profile = await service.create('user-1', {
      providerKind: 'openai-compatible',
      presetId: 'openai',
      providerId: 'openai',
      modelId: 'unlisted-openai-model',
      baseUrl: 'https://attacker.example/v1',
      api: 'anthropic-messages',
      apiKey: 'secret-api-key',
    });

    Object.assign(store.rows[0]!, {
      baseUrl: 'https://legacy-attacker.example/v1',
      api: 'anthropic-messages',
    });
    await expect(service.resolve('user-1', profile.id)).resolves.toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-completions',
    });

    expect(profile.baseUrl).toBe('https://api.openai.com/v1');
    expect(profile.api).toBe('openai-completions');

    const updated = await service.update('user-1', profile.id, {
      providerKind: 'openai-compatible',
      presetId: 'openai',
      providerId: 'openai',
      modelId: 'another-unlisted-openai-model',
      baseUrl: 'https://attacker.example/v1',
      api: 'anthropic-messages',
    });
    expect(updated.baseUrl).toBe('https://api.openai.com/v1');
    expect(updated.api).toBe('openai-completions');
  });
});
