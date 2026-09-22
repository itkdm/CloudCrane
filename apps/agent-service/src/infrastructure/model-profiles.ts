import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { userModelProfile, type PlatformDb } from '@cloudcrane/db';
import { AgentServiceError } from '../application/errors.js';
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
  modelId: string;
  displayName?: string;
  baseUrl?: string;
  api?: string;
  apiKey: string;
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

function normalizeBaseUrl(
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
  if (
    url.protocol !== 'https:' &&
    !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')
  )
    throw new AgentServiceError('INVALID_ARGUMENT', 'base URL must use HTTPS', 400);
  if (providerKind !== 'openai-compatible')
    throw new AgentServiceError(
      'INVALID_ARGUMENT',
      'base URL is only supported for OpenAI-compatible providers',
      400,
    );
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/$/, '');
}

function validateInput(input: ModelProfileInput | ModelProfileUpdateInput): void {
  if (!input.providerId.trim() || input.providerId.length > 128)
    throw new AgentServiceError('INVALID_ARGUMENT', 'provider is invalid', 400);
  if (!input.modelId.trim() || input.modelId.length > 255)
    throw new AgentServiceError('INVALID_ARGUMENT', 'model is invalid', 400);
  if (input.apiKey !== undefined && (!input.apiKey.trim() || input.apiKey.length > 16_384))
    throw new AgentServiceError('INVALID_ARGUMENT', 'API key is invalid', 400);
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
    if (input.providerKind === 'openai-compatible' && !(input.baseUrl ?? preset?.baseUrl))
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'base URL is required for custom OpenAI-compatible providers',
        400,
      );
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? preset?.baseUrl, input.providerKind);
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
        providerId,
        modelId: input.modelId.trim(),
        displayName:
          input.displayName?.trim() ||
          preset?.models.find((model) => model.id === input.modelId)?.name ||
          `${input.providerId}/${input.modelId}`,
        baseUrl,
        api:
          input.providerKind === 'openai-compatible'
            ? (input.api ?? preset?.api ?? 'openai-completions')
            : null,
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
    if (input.providerKind === 'openai-compatible' && !(input.baseUrl ?? preset?.baseUrl))
      throw new AgentServiceError(
        'INVALID_ARGUMENT',
        'base URL is required for custom OpenAI-compatible providers',
        400,
      );
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? preset?.baseUrl, input.providerKind);
    const existing = await this.platform.db
      .select()
      .from(userModelProfile)
      .where(and(eq(userModelProfile.id, profileId), eq(userModelProfile.userId, userId)))
      .limit(1);
    const row = existing[0];
    if (!row)
      throw new AgentServiceError('MODEL_PROFILE_NOT_FOUND', 'model profile was not found', 404);

    const encrypted = input.apiKey?.trim() ? this.encrypt(input.apiKey) : undefined;
    const updated = await this.platform.db
      .update(userModelProfile)
      .set({
        presetId: preset?.id ?? null,
        modelId: input.modelId.trim(),
        displayName:
          input.displayName?.trim() ||
          preset?.models.find((model) => model.id === input.modelId)?.name ||
          `${input.providerId}/${input.modelId}`,
        baseUrl,
        api: input.api ?? preset?.api ?? 'openai-completions',
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
      modelId: row.modelId,
      displayName: row.displayName,
      baseUrl: row.baseUrl,
      api: row.api,
      keyHint: row.keyHint,
      isDefault: row.isDefault,
      input: presetModel?.input ?? ['text'],
      reasoning: presetModel?.reasoning ?? false,
      contextWindow: presetModel?.contextWindow ?? 128_000,
      maxTokens: presetModel?.maxTokens ?? 16_384,
      supportsTools: presetModel?.supportsTools ?? true,
    };
  }

  private toResolved(row: typeof userModelProfile.$inferSelect): ResolvedModelProfile {
    return { ...this.toPublic(row), providerId: row.providerId, apiKey: this.decrypt(row) };
  }
}
