import { describe, expect, it } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import {
  CUSTOM_MODEL_PRESET_ID,
  findModelPreset,
  findPresetModel,
  listPublicModelPresets,
} from './model-catalog.js';
import { createSecureProviderFetch } from './secure-provider-fetch.js';

describe('model catalog', () => {
  it('exposes provider presets without credentials', () => {
    const presets = listPublicModelPresets();
    expect(presets.map((preset) => preset.id)).toEqual([
      'openai',
      'deepseek',
      'qwen',
      'anthropic',
      'zhipu',
      'moonshot',
    ]);
    expect(JSON.stringify(presets)).not.toContain('apiKey');
  });

  it('resolves model-specific capabilities', () => {
    expect(findPresetModel('qwen', 'qwen3-vl-plus')?.input).toEqual(['text', 'image']);
    expect(findPresetModel('deepseek', 'deepseek-v4-pro')?.input).toEqual(['text']);
    expect(findModelPreset('missing')).toBeUndefined();
    expect(CUSTOM_MODEL_PRESET_ID).toBe('custom-openai-compatible');
  });

  it('registers a user-defined OpenAI-compatible model in the pinned Pi runtime', async () => {
    const runtime = await ModelRuntime.create({ refreshOnCreate: false });
    runtime.registerProvider('cloudcrane-test-provider', {
      name: 'Test Provider',
      baseUrl: 'https://llm.example.com/v1',
      api: 'openai-completions',
      models: [
        {
          id: 'test-model',
          name: 'Test Model',
          api: 'openai-completions',
          reasoning: true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32_000,
          maxTokens: 4_096,
        },
      ],
      streamSimple: (model, context, options) =>
        openAICompletionsApi().streamSimple(model, context, {
          ...options,
          fetch: createSecureProviderFetch('https://llm.example.com/v1'),
        }),
    });

    expect(
      runtime.getRegisteredProviderConfig('cloudcrane-test-provider')?.streamSimple,
    ).toBeTypeOf('function');
    expect(runtime.getModel('cloudcrane-test-provider', 'test-model')).toMatchObject({
      provider: 'cloudcrane-test-provider',
      id: 'test-model',
      api: 'openai-completions',
      baseUrl: 'https://llm.example.com/v1',
      contextWindow: 32_000,
      maxTokens: 4_096,
    });
  });
});
