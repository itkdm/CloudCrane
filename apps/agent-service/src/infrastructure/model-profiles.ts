import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { userModelProfile, type PlatformDb } from '@cloudcrane/db';
import { AgentServiceError } from '../application/errors.js';
import { assertPublicProviderHost } from './secure-provider-fetch.js';
import {
  CUSTOM_MODEL_PRESET_ID,
  findModelPreset,
  findPresetModel,
  type ModelInput,
} from './model-catalog.js';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_VERSION = 'v1';

export type ModelProfileInput = {
  providerKind: 'builtin' | 'openai-compatible';
  presetId?: string;
  providerId: string;
  providerName?: string;
  modelId: string;
  displayName?: string;
  baseUrl?: string;
  api?: string;
  apiKey: string;
  input?: ModelInput[];
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  isDefault?: boolean;
};

export type ModelProfileUpdateInput = Omit<ModelProfileInput, 'apiKey' | 'isDefault'> & {
  apiKey?: string;
};

export type PublicModelProfile = {
  id: string;
  providerKind: 'builtin' | 'openai-compatible';
  presetId: string | null;
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  baseUrl: string | null;
  api: string | null;
  keyHint: string;
  isDefault: boolean;
  input: ModelInput[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  supportsTools: boolean;
};

export type ResolvedModelProfile = PublicModelProfile & { apiKey: string };

type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
};

async function normalizeBaseUrl(
  value: string | undefined,
  providerKind: ModelProfileInput['providerKind'],
) {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentServiceError('INVALID_ARGUMENT', 'base URL is invalid', 400);
  }
  if (url.protocol !== 'https:')
    throw new AgentServiceError('INVALID_ARGUMENT', 'base URL must use HTTPS', 400);
  if (providerKind !== 'openai-compatible')
    throw new AgentServiceError(
      'INVALID_ARGUMENT',
      'base URL is only supported for OpenAI-compatible providers',
      400,
    );
  if (url.username || url.password || url.search || url.hash)
    throw new AgentServiceError(
      'INVALID_ARGUMENT',
      'base URL must not contain credentials or query parameters',
      400,
    );
  try {
    await assertPublicProviderHost(url.hostname);
  } catch {
    throw new AgentServiceError(
      'INVALID_ARGUMENT',
      'base URL host must resolve only to public addresses',
      400,
    );
  }
  return url.toString().replace(/\/$/, '');
}

function validateInput(input: ModelProfileInput | ModelProfileUpdateInput): void {
  if (!input.providerId.trim() || input.providerId.length > 128)
    throw new AgentServiceError('INVALID_ARGUMENT', 'provider is invalid', 400);
  if (!input.modelId.trim() || input.modelId.length > 255)
    throw new AgentServiceError('INVALID_ARGUMENT', 'model is invalid', 400);
  if (
    input.providerName !== undefined &&
    (!input.providerName.trim() || input.providerName.length > 128)
  )
    throw new AgentServiceError('INVALID_ARGUMENT', 'provider name is invalid', 400);
  if (input.apiKey !== undefined && (!input.apiKey.trim() || input.apiKey.length > 16_384))
    throw new AgentServiceError('INVALID_ARGUMENT', 'API key is invalid', 400);
  if (
    input.input !== undefined &&
    (input.input.length === 0 || input.input.some((item) => item !== 'text' && item !== 'image'))
  )
    throw new AgentServiceError('INVALID_ARGUMENT', 'model input capability is invalid', 400);
  if (
    input.api !== undefined &&
    ![
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
      'mistral-conversations',
    ].includes(input.api)
  )
    throw new AgentServiceError('INVALID_ARGUMENT', 'model API is unsupported', 400);
  if (
    input.contextWindow !== undefined &&
    (!Number.isInteger(input.contextWindow) || input.contextWindow < 1_024)
  )
    throw new AgentServiceError('INVALID_ARGUMENT', 'context window is invalid', 400);
  if (input.maxTokens !== undefined && (!Number.isInteger(input.maxTokens) || input.maxTokens < 1))
    throw new AgentServiceError('INVALID_ARGUMENT', 'maximum output tokens is invalid', 400);
}

function resolvePreset(input: ModelProfileInput | ModelProfileUpdateInput) {
  if (!input.presetId || input.presetId === CUSTOM_MODEL_PRESET_ID) return undefined;
  const preset = findModelPreset(input.presetId);
  if (!preset || preset.providerId !== input.providerId)
    throw new AgentServiceError('INVALID_ARGUMENT', 'model provider preset is invalid', 400);
  return preset;
}

function keyHint(apiKey: string): string {
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}…`;
  return `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`;
}

function cryptoKey(value: string): Buffer {
  const trimmed = value.trim();
  const decoded = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (decoded.length !== 32)
    throw new Error('MODEL_CREDENTIAL_ENCRYPTION_KEY must encode 32 bytes');
  return decoded;
}

export class ModelProfileService {
  private readonly key: Buffer;

  constructor(
    private readonly platform: PlatformDb,
    encryptionKey: string,
  ) {
    this.key = cryptoKey(encryptionKey);
  }

  async list(userId: string): Promise<PublicModelProfile[]> {
    const rows = await this.platform.db
      .select()
      .from(userModelProfile)
      .where(eq(userModelProfile.userId, userId))
      .orderBy(desc(userModelProfile.isDefault), desc(userModelProfile.updatedAt));
    return rows.map((row) => this.toPublic(row));
  }

  async create(userId: string, input: ModelProfileInput): Promise<PublicModelProfile> {
    validateInput(input);
    const preset = resolvePreset(input);
    const configuredBaseUrl = preset?.baseUrl ?? input.baseUrl;
    if (input.providerKind === 'openai-compatible' && !configuredBaseUrl)
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'base URL is required for custom OpenAI-compatible providers',
        400,
      );
    const baseUrl = await normalizeBaseUrl(configuredBaseUrl, input.providerKind);
    if (!preset && input.api !== undefined && input.api !== 'openai-completions')
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'custom providers must use OpenAI-compatible chat completions',
        400,
      );
    const presetModel = findPresetModel(input.presetId, input.modelId);
    const capabilities = presetModel ?? {
      input: input.input ?? ['text'],
      reasoning: input.reasoning ?? false,
      contextWindow: input.contextWindow ?? 128_000,
      maxTokens: input.maxTokens ?? 16_384,
    };
    const id = randomUUID();
    const providerId =
      input.providerKind === 'openai-compatible'
        ? `cloudcrane-profile-${id}`
        : input.providerId.trim();
    const encrypted = this.encrypt(input.apiKey);
    const makeDefault = input.isDefault ?? (await this.list(userId)).length === 0;
    if (makeDefault)
      await this.platform.db
        .update(userModelProfile)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(userModelProfile.userId, userId));
    const rows = await this.platform.db
      .insert(userModelProfile)
      .values({
        id,
        userId,
        providerKind: input.providerKind,
        presetId: preset?.id ?? null,
        providerName: preset?.providerName ?? input.providerName?.trim() ?? input.providerId.trim(),
        providerId,
        modelId: input.modelId.trim(),
        displayName:
          input.displayName?.trim() ||
          preset?.models.find((model) => model.id === input.modelId)?.name ||
          `${preset?.providerName ?? input.providerName?.trim() ?? input.providerId}/${input.modelId}`,
        baseUrl,
        api:
          input.providerKind === 'openai-compatible'
            ? (preset?.api ?? input.api ?? 'openai-completions')
            : null,
        input: capabilities.input,
        reasoning: capabilities.reasoning,
        contextWindow: capabilities.contextWindow,
        maxTokens: capabilities.maxTokens,
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
        encryptionKeyVersion: encrypted.keyVersion,
        keyHint: keyHint(input.apiKey),
        isDefault: makeDefault,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('model profile was not created');
    return this.toPublic(row);
  }

  async update(
    userId: string,
    profileId: string,
    input: ModelProfileUpdateInput,
  ): Promise<PublicModelProfile> {
    validateInput(input);
    const preset = resolvePreset(input);
    const configuredBaseUrl = preset?.baseUrl ?? input.baseUrl;
    if (input.providerKind === 'openai-compatible' && !configuredBaseUrl)
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'base URL is required for custom OpenAI-compatible providers',
        400,
      );
    const baseUrl = await normalizeBaseUrl(configuredBaseUrl, input.providerKind);
    if (!preset && input.api !== undefined && input.api !== 'openai-completions')
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'custom providers must use OpenAI-compatible chat completions',
        400,
      );
    const existing = await this.platform.db
      .select()
      .from(userModelProfile)
      .where(and(eq(userModelProfile.id, profileId), eq(userModelProfile.userId, userId)))
      .limit(1);
    const row = existing[0];
    if (!row)
      throw new AgentServiceError('MODEL_PROFILE_NOT_FOUND', 'model profile was not found', 404);
    const presetModel = findPresetModel(input.presetId, input.modelId);
    const capabilities = presetModel ?? {
      input: input.input ?? (row.input as ModelInput[]) ?? ['text'],
      reasoning: input.reasoning ?? row.reasoning ?? false,
      contextWindow: input.contextWindow ?? row.contextWindow ?? 128_000,
      maxTokens: input.maxTokens ?? row.maxTokens ?? 16_384,
    };

    const encrypted = input.apiKey?.trim() ? this.encrypt(input.apiKey) : undefined;
    const updated = await this.platform.db
      .update(userModelProfile)
      .set({
        presetId: preset?.id ?? null,
        providerName: preset?.providerName ?? input.providerName?.trim() ?? row.providerName,
        modelId: input.modelId.trim(),
        displayName:
          input.displayName?.trim() ||
          preset?.models.find((model) => model.id === input.modelId)?.name ||
          `${preset?.providerName ?? input.providerName?.trim() ?? input.providerId}/${input.modelId}`,
        baseUrl,
        api: preset?.api ?? input.api ?? 'openai-completions',
        input: capabilities.input,
        reasoning: capabilities.reasoning,
        contextWindow: capabilities.contextWindow,
        maxTokens: capabilities.maxTokens,
        ...(encrypted
          ? {
              apiKeyCiphertext: encrypted.ciphertext,
              apiKeyIv: encrypted.iv,
              apiKeyAuthTag: encrypted.authTag,
              encryptionKeyVersion: encrypted.keyVersion,
              keyHint: keyHint(input.apiKey ?? ''),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(userModelProfile.id, row.id), eq(userModelProfile.userId, userId)))
      .returning();
    if (!updated[0]) throw new Error('model profile was not updated');
    return this.toPublic(updated[0]);
  }

  async delete(userId: string, profileId: string): Promise<void> {
    const result = await this.platform.db
      .delete(userModelProfile)
      .where(and(eq(userModelProfile.id, profileId), eq(userModelProfile.userId, userId)))
      .returning({ id: userModelProfile.id });
    if (result.length === 0)
      throw new AgentServiceError('MODEL_PROFILE_NOT_FOUND', 'model profile was not found', 404);
    const replacement = await this.platform.db
      .select({ id: userModelProfile.id })
      .from(userModelProfile)
      .where(eq(userModelProfile.userId, userId))
      .orderBy(desc(userModelProfile.updatedAt))
      .limit(1);
    if (replacement[0])
      await this.platform.db
        .update(userModelProfile)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(userModelProfile.id, replacement[0].id));
  }

  async resolveDefault(userId: string): Promise<ResolvedModelProfile | null> {
    const rows = await this.platform.db
      .select()
      .from(userModelProfile)
      .where(eq(userModelProfile.userId, userId))
      .orderBy(desc(userModelProfile.isDefault), desc(userModelProfile.updatedAt))
      .limit(1);
    return rows[0] ? this.toResolved(rows[0]) : null;
  }

  async resolve(userId: string, profileId: string): Promise<ResolvedModelProfile> {
    const rows = await this.platform.db
      .select()
      .from(userModelProfile)
      .where(and(eq(userModelProfile.id, profileId), eq(userModelProfile.userId, userId)))
      .limit(1);
    if (!rows[0])
      throw new AgentServiceError('MODEL_PROFILE_NOT_FOUND', 'model profile was not found', 404);
    return this.toResolved(rows[0]);
  }

  private encrypt(value: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: ENCRYPTION_KEY_VERSION,
    };
  }

  private decrypt(row: typeof userModelProfile.$inferSelect): string {
    try {
      const decipher = createDecipheriv(
        ENCRYPTION_ALGORITHM,
        this.key,
        Buffer.from(row.apiKeyIv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(row.apiKeyAuthTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(row.apiKeyCiphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new AgentServiceError(
        'MODEL_CREDENTIAL_UNAVAILABLE',
        'model credential is unavailable',
        503,
      );
    }
  }

  private toPublic(row: typeof userModelProfile.$inferSelect): PublicModelProfile {
    const presetModel = findPresetModel(row.presetId ?? undefined, row.modelId);
    const preset = findModelPreset(row.presetId ?? undefined);
    return {
      id: row.id,
      providerKind: row.providerKind as PublicModelProfile['providerKind'],
      presetId: row.presetId,
      providerId:
        preset?.providerId ??
        (row.providerKind === 'openai-compatible' ? 'openai-compatible' : row.providerId),
      providerName: preset?.providerName ?? row.providerName,
      modelId: row.modelId,
      displayName: row.displayName,
      baseUrl: preset?.baseUrl ?? row.baseUrl,
      api: preset?.api ?? row.api,
      keyHint: row.keyHint,
      isDefault: row.isDefault,
      input: (presetModel?.input ?? row.input) as ModelInput[],
      reasoning: presetModel?.reasoning ?? row.reasoning,
      contextWindow: presetModel?.contextWindow ?? row.contextWindow,
      maxTokens: presetModel?.maxTokens ?? row.maxTokens,
      supportsTools: presetModel?.supportsTools ?? true,
    };
  }

  private toResolved(row: typeof userModelProfile.$inferSelect): ResolvedModelProfile {
    return { ...this.toPublic(row), providerId: row.providerId, apiKey: this.decrypt(row) };
  }
}
