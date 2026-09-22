import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { userModelProfile, type PlatformDb } from '@cloudcrane/db';
import { AgentServiceError } from '../application/errors.js';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_VERSION = 'v1';

export type ModelProfileInput = {
  providerKind: 'builtin' | 'openai-compatible';
  providerId: string;
  modelId: string;
  displayName?: string;
  baseUrl?: string;
  api?: string;
  apiKey: string;
  isDefault?: boolean;
};

export type PublicModelProfile = {
  id: string;
  providerKind: 'builtin' | 'openai-compatible';
  providerId: string;
  modelId: string;
  displayName: string;
  baseUrl: string | null;
  api: string | null;
  keyHint: string;
  isDefault: boolean;
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

function validateInput(input: ModelProfileInput): void {
  if (!input.providerId.trim() || input.providerId.length > 128)
    throw new AgentServiceError('INVALID_ARGUMENT', 'provider is invalid', 400);
  if (!input.modelId.trim() || input.modelId.length > 255)
    throw new AgentServiceError('INVALID_ARGUMENT', 'model is invalid', 400);
  if (!input.apiKey.trim() || input.apiKey.length > 16_384)
    throw new AgentServiceError('INVALID_ARGUMENT', 'API key is invalid', 400);
  if (input.providerKind === 'openai-compatible' && !input.baseUrl)
    throw new AgentServiceError(
      'INVALID_ARGUMENT',
      'base URL is required for OpenAI-compatible providers',
      400,
    );
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
    const baseUrl = normalizeBaseUrl(input.baseUrl, input.providerKind);
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
        providerId,
        modelId: input.modelId.trim(),
        displayName: input.displayName?.trim() || `${input.providerId}/${input.modelId}`,
        baseUrl,
        api:
          input.providerKind === 'openai-compatible' ? (input.api ?? 'openai-completions') : null,
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
    return {
      id: row.id,
      providerKind: row.providerKind as PublicModelProfile['providerKind'],
      providerId: row.providerKind === 'openai-compatible' ? 'openai-compatible' : row.providerId,
      modelId: row.modelId,
      displayName: row.displayName,
      baseUrl: row.baseUrl,
      api: row.api,
      keyHint: row.keyHint,
      isDefault: row.isDefault,
    };
  }

  private toResolved(row: typeof userModelProfile.$inferSelect): ResolvedModelProfile {
    return { ...this.toPublic(row), providerId: row.providerId, apiKey: this.decrypt(row) };
  }
}
