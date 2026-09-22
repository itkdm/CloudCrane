import type { Api } from '@earendil-works/pi-ai';

export type ModelInput = 'text' | 'image';

export type ModelPreset = {
  id: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  api: Api;
  models: Array<{
    id: string;
    name: string;
    input: ModelInput[];
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
    supportsTools: boolean;
  }>;
};

// Keep this catalog server-owned. Users choose a preset, but may still enter a
// provider-specific model id when the provider exposes a newer or private model.
export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    id: 'openai',
    providerId: 'openai',
    providerName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    models: [
      model('gpt-5.6-luna', 'GPT-5.6 Luna', ['text', 'image'], true, 1_050_000, 128_000),
      model('gpt-5.6-terra', 'GPT-5.6 Terra', ['text', 'image'], true, 1_050_000, 128_000),
      model('gpt-5.6-sol', 'GPT-5.6 Sol', ['text', 'image'], true, 1_050_000, 128_000),
    ],
  },
  {
    id: 'deepseek',
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    api: 'openai-completions',
    models: [
      model('deepseek-flash', 'DeepSeek Flash', ['text', 'image'], true, 1_000_000, 384_000),
      model('deepseek-v4-pro', 'DeepSeek V4 Pro', ['text'], true, 1_000_000, 384_000),
    ],
  },
  {
    id: 'qwen',
    providerId: 'qwen',
    providerName: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai-completions',
    models: [
      model('qwen-plus', 'Qwen Plus', ['text'], true, 1_000_000, 65_536),
      model('qwen-max', 'Qwen Max', ['text'], true, 1_000_000, 65_536),
      model('qwen3-vl-plus', 'Qwen3 VL Plus', ['text', 'image'], true, 1_000_000, 65_536),
    ],
  },
  {
    id: 'anthropic',
    providerId: 'anthropic',
    providerName: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    models: [
      model('claude-sonnet-4', 'Claude Sonnet', ['text', 'image'], true, 200_000, 64_000),
      model('claude-opus-4', 'Claude Opus', ['text', 'image'], true, 200_000, 64_000),
    ],
  },
  {
    id: 'zhipu',
    providerId: 'zhipu',
    providerName: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions',
    models: [
      model('glm-4.5', 'GLM-4.5', ['text'], true, 128_000, 32_000),
      model('glm-4.5v', 'GLM-4.5V', ['text', 'image'], true, 128_000, 32_000),
    ],
  },
  {
    id: 'moonshot',
    providerId: 'moonshot',
    providerName: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    api: 'openai-completions',
    models: [
      model('kimi-k2.5', 'Kimi K2.5', ['text', 'image'], true, 262_144, 32_768),
      model('kimi-k2', 'Kimi K2', ['text'], true, 131_072, 16_384),
    ],
  },
];

export const CUSTOM_MODEL_PRESET_ID = 'custom-openai-compatible';

export type PublicModelPreset = Omit<ModelPreset, 'api'> & { api: string };

export function listPublicModelPresets(): PublicModelPreset[] {
  return MODEL_PRESETS.map((preset) => ({
    ...preset,
    models: preset.models.map((item) => ({ ...item })),
  }));
}

export function findModelPreset(id: string | undefined): ModelPreset | undefined {
  return MODEL_PRESETS.find((preset) => preset.id === id);
}

export function findPresetModel(presetId: string | undefined, modelId: string) {
  return findModelPreset(presetId)?.models.find((item) => item.id === modelId);
}

function model(
  id: string,
  name: string,
  input: ModelInput[],
  reasoning: boolean,
  contextWindow: number,
  maxTokens: number,
) {
  return { id, name, input, reasoning, contextWindow, maxTokens, supportsTools: true };
}
