import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MODEL_PRESET_ID,
  findModelPreset,
  findPresetModel,
  listPublicModelPresets,
} from './model-catalog.js';

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
});
