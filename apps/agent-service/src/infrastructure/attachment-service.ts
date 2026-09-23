import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import type { AttachmentStorage } from '@cloudcrane/attachment-storage';
import { conversationAttachment, websiteSession, type PlatformDb } from '@cloudcrane/db';
import type { AttachmentRef } from '@cloudcrane/agent-protocol';
import { AgentServiceError } from '../application/errors.js';
import {
  AttachmentQuotaError,
  type AttachmentQuotaReservation,
  type DrizzleAttachmentQuotaService,
} from './attachment-quota.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const SESSION_ATTACHMENT_QUOTA = 50 * 1024 * 1024;

export type AttachmentUploadPart = {
  type: 'file';
  fieldname: string;
  filename: string;
  mimetype: string;
  file: NodeJS.ReadableStream & { truncated?: boolean };
};

export class ConversationAttachmentService {
  constructor(
    private readonly db: PlatformDb['db'],
    private readonly storage: AttachmentStorage,
    private readonly storageDriver: 'local' | 'oss',
    private readonly maxBytes: number,
    private readonly quota?: Pick<
      DrizzleAttachmentQuotaService,
      | 'reserve'
      | 'release'
      | 'releaseForAttachment'
      | 'commitAndFinalize'
      | 'cleanupExpiredReservations'
    >,
  ) {}

  async upload(input: {
    userId: string;
    websiteId: string;
    sessionId: string;
    idempotencyKey: string;
    contentSha256: string;
    part: AttachmentUploadPart;
  }): Promise<AttachmentRef & { sha256: string; created: boolean }> {
    const kind = classify(input.part.filename, input.part.mimetype);
    if (!kind) throw new AgentServiceError('INVALID_ARGUMENT', 'unsupported attachment type', 415);
    if (input.part.filename.length > 255)
      throw new AgentServiceError('INVALID_ARGUMENT', 'attachment filename is too long', 400);
    const session = await this.db.query.websiteSession.findFirst({
      where: and(
        eq(websiteSession.id, input.sessionId),
        eq(websiteSession.websiteId, input.websiteId),
      ),
      columns: { id: true },
    });
    if (!session)
      throw new AgentServiceError('SESSION_NOT_FOUND', 'website session was not found', 404);
    const id = crypto.randomUUID();
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          filename: input.part.filename,
          mimetype: input.part.mimetype,
          contentSha256: input.contentSha256,
          userId: input.userId,
          websiteId: input.websiteId,
          sessionId: input.sessionId,
        }),
      )
      .digest('hex');
    const key = `attachments/${input.userId}/${input.websiteId}/${input.sessionId}/${id}/blob`;
    let reservation: AttachmentQuotaReservation | undefined;
    if (this.quota) {
      try {
        reservation = await this.quota.reserve({
          attachmentId: id,
          userId: input.userId,
          websiteId: input.websiteId,
          sessionId: input.sessionId,
          quantity: this.maxBytes,
          idempotencyKey: input.idempotencyKey,
          requestHash,
        });
      } catch (error) {
        if (error instanceof AttachmentQuotaError && error.code === 'QUOTA_EXCEEDED')
          throw new AgentServiceError(
            'ATTACHMENT_INVALID',
            'attachment storage quota exceeded',
            413,
          );
        if (error instanceof AttachmentQuotaError && error.code === 'IDEMPOTENCY_CONFLICT')
          throw new AgentServiceError(
            'ATTACHMENT_INVALID',
            'attachment idempotency key was already used with different parameters',
            409,
          );
        throw new AgentServiceError(
          'INTERNAL_ERROR',
          'attachment quota is temporarily unavailable',
          503,
        );
      }
      if (reservation.attachmentId && reservation.attachmentId !== id) {
        input.part.file.resume();
        const existing = await this.db.query.conversationAttachment.findFirst({
          where: eq(conversationAttachment.id, reservation.attachmentId),
        });
        if (!existing || existing.status !== 'ready')
          throw new AgentServiceError(
            'ATTACHMENT_INVALID',
            'attachment upload is in progress',
            409,
          );
        return {
          id: existing.id,
          kind: existing.kind as 'image' | 'document',
          name: existing.originalFilename,
          mimeType: existing.contentType,
          size: existing.sizeBytes,
          sha256: existing.sha256,
          created: false,
        };
      }
    } else {
      const quota = await this.db
        .select({ total: sql<number>`coalesce(sum(${conversationAttachment.sizeBytes}), 0)` })
        .from(conversationAttachment)
        .where(
          and(
            eq(conversationAttachment.ownerId, input.userId),
            eq(conversationAttachment.websiteId, input.websiteId),
            eq(conversationAttachment.sessionId, input.sessionId),
            eq(conversationAttachment.status, 'ready'),
          ),
        );
      if (Number(quota[0]?.total ?? 0) >= SESSION_ATTACHMENT_QUOTA)
        throw new AgentServiceError('INVALID_ARGUMENT', 'session attachment quota exceeded', 413);
    }
    const now = new Date();
    let object;
    try {
      await this.db.insert(conversationAttachment).values({
        id,
        ownerId: input.userId,
        websiteId: input.websiteId,
        sessionId: input.sessionId,
        originalFilename: input.part.filename,
        contentType: normalizeContentType(input.part.mimetype, input.part.filename),
        kind,
        sizeBytes: 1,
        sha256: '0'.repeat(64),
        storageDriver: this.storageDriver,
        storageKey: key,
        status: 'uploading',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
      object = await this.storage.put({
        key,
        source: input.part.file,
        contentType: normalizeContentType(input.part.mimetype, input.part.filename),
        maxBytes: this.maxBytes,
      });
    } catch (error) {
      if (this.quota && reservation) await this.quota.release(reservation).catch(() => undefined);
      await this.storage.delete(key).catch(() => undefined);
      await this.db
        .update(conversationAttachment)
        .set({ status: 'failed', errorCode: 'UPLOAD_FAILED' })
        .where(
          and(eq(conversationAttachment.id, id), eq(conversationAttachment.status, 'uploading')),
        )
        .catch(() => undefined);
      if (error instanceof Error && /exceeds maximum size/i.test(error.message))
        throw new AgentServiceError('INVALID_ARGUMENT', 'attachment is too large', 413);
      throw error;
    }
    try {
      if (object.size <= 0 || object.size > this.maxBytes || input.part.file.truncated)
        throw new AgentServiceError('INVALID_ARGUMENT', 'attachment is too large', 413);
      if (object.sha256 !== input.contentSha256)
        throw new AgentServiceError('INVALID_ARGUMENT', 'attachment checksum mismatch', 400);
      if (!this.quota) {
        const currentQuota = await this.db
          .select({ total: sql<number>`coalesce(sum(${conversationAttachment.sizeBytes}), 0)` })
          .from(conversationAttachment)
          .where(
            and(
              eq(conversationAttachment.ownerId, input.userId),
              eq(conversationAttachment.websiteId, input.websiteId),
              eq(conversationAttachment.sessionId, input.sessionId),
              eq(conversationAttachment.status, 'ready'),
            ),
          );
        if (Number(currentQuota[0]?.total ?? 0) + object.size > SESSION_ATTACHMENT_QUOTA)
          throw new AgentServiceError('INVALID_ARGUMENT', 'session attachment quota exceeded', 413);
      }
      if (
        kind === 'image' &&
        !(await hasValidImageHeader(this.storage, object.key, object.contentType))
      )
        throw new AgentServiceError(
          'INVALID_ARGUMENT',
          'attachment content does not match its image type',
          415,
        );
      const finalizedMetadata = await this.db
        .update(conversationAttachment)
        .set({
          contentType: object.contentType,
          sizeBytes: object.size,
          sha256: object.sha256,
          status: this.quota ? 'uploading' : 'ready',
        })
        .where(
          and(eq(conversationAttachment.id, id), eq(conversationAttachment.status, 'uploading')),
        );
      if (finalizedMetadata.rowCount !== 1)
        throw new AgentServiceError(
          'ATTACHMENT_INVALID',
          'attachment upload is no longer active',
          409,
        );
      if (this.quota && reservation) {
        await this.quota.commitAndFinalize({
          ...reservation,
          actualBytes: object.size,
          attachmentId: id,
        });
      }
    } catch (error) {
      await this.storage.delete(object.key).catch(() => undefined);
      if (this.quota && reservation)
        await this.quota.releaseForAttachment(id).catch(() => undefined);
      await this.db
        .update(conversationAttachment)
        .set({ status: 'failed', errorCode: 'UPLOAD_FAILED' })
        .where(
          and(
            eq(conversationAttachment.id, id),
            or(
              eq(conversationAttachment.status, 'uploading'),
              eq(conversationAttachment.status, 'ready'),
            ),
          ),
        )
        .catch(() => undefined);
      throw error;
    }
    return {
      id,
      kind,
      name: input.part.filename,
      mimeType: object.contentType,
      size: object.size,
      sha256: object.sha256,
      created: true,
    };
  }

  async resolve(input: {
    ownerId?: string;
    websiteId: string;
    sessionId: string;
    attachments: AttachmentRef[];
  }): Promise<Array<AttachmentRef & { contentType: string; stream: NodeJS.ReadableStream }>> {
    if (input.attachments.length === 0) return [];
    const resolved = [] as Array<
      AttachmentRef & { contentType: string; stream: NodeJS.ReadableStream }
    >;
    for (const requested of input.attachments) {
      const row = await this.db.query.conversationAttachment.findFirst({
        where: and(
          eq(conversationAttachment.id, requested.id),
          eq(conversationAttachment.websiteId, input.websiteId),
          eq(conversationAttachment.sessionId, input.sessionId),
          eq(conversationAttachment.status, 'ready'),
          ...(input.ownerId ? [eq(conversationAttachment.ownerId, input.ownerId)] : []),
        ),
      });
      if (!row || row.originalFilename !== requested.name || row.sizeBytes !== requested.size)
        throw new AgentServiceError(
          'INVALID_ARGUMENT',
          'attachment is not valid for this session',
          400,
        );
      resolved.push({
        id: row.id,
        kind: row.kind as 'image' | 'document',
        name: row.originalFilename,
        mimeType: row.contentType,
        size: row.sizeBytes,
        contentType: row.contentType,
        stream: await this.storage.open(row.storageKey),
      });
    }
    return resolved;
  }

  async cleanupExpired(now = new Date()): Promise<void> {
    if (this.quota) await this.quota.cleanupExpiredReservations(now);
    const expired = await this.db.query.conversationAttachment.findMany({
      where: and(
        or(
          and(
            lt(conversationAttachment.expiresAt, now),
            eq(conversationAttachment.status, 'ready'),
          ),
          and(
            lt(conversationAttachment.createdAt, new Date(now.getTime() - 15 * 60 * 1000)),
            or(
              eq(conversationAttachment.status, 'uploading'),
              eq(conversationAttachment.status, 'deleting'),
              eq(conversationAttachment.status, 'failed'),
            ),
          ),
        ),
      ),
      limit: 100,
    });
    for (const row of expired) {
      const claim = await this.db
        .update(conversationAttachment)
        .set({ status: 'deleting' })
        .where(
          and(
            eq(conversationAttachment.id, row.id),
            or(
              eq(conversationAttachment.status, 'ready'),
              eq(conversationAttachment.status, 'uploading'),
              eq(conversationAttachment.status, 'deleting'),
              eq(conversationAttachment.status, 'failed'),
            ),
          ),
        );
      if (claim.rowCount !== 1) continue;
      try {
        await this.storage.delete(row.storageKey);
        if (this.quota) await this.quota.releaseForAttachment(row.id);
        await this.db
          .update(conversationAttachment)
          .set({ status: 'deleted', deletedAt: now })
          .where(
            and(
              eq(conversationAttachment.id, row.id),
              eq(conversationAttachment.status, 'deleting'),
            ),
          );
      } catch {
        await this.db
          .update(conversationAttachment)
          .set({
            status: (row.status ?? 'ready') === 'ready' ? 'ready' : row.status,
            errorCode: 'STORAGE_DELETE_FAILED',
          })
          .where(
            and(
              eq(conversationAttachment.id, row.id),
              eq(conversationAttachment.status, 'deleting'),
            ),
          );
      }
    }
  }

  async remove(
    id: string,
    userId: string,
    websiteId?: string,
    sessionId?: string,
    allowAnyOwner = false,
  ): Promise<void> {
    const ownership = [
      eq(conversationAttachment.id, id),
      ...(allowAnyOwner ? [] : [eq(conversationAttachment.ownerId, userId)]),
      ...(websiteId ? [eq(conversationAttachment.websiteId, websiteId)] : []),
      ...(sessionId ? [eq(conversationAttachment.sessionId, sessionId)] : []),
    ];
    const row = await this.db.query.conversationAttachment.findFirst({
      where: and(...ownership),
    });
    if (!row) return;
    const claimed = await this.db
      .update(conversationAttachment)
      .set({ status: 'deleting' })
      .where(
        and(
          ...ownership,
          or(
            eq(conversationAttachment.status, 'ready'),
            eq(conversationAttachment.status, 'uploading'),
          ),
        ),
      )
      .returning({ id: conversationAttachment.id });
    if (claimed.length === 0) return;
    await this.storage.delete(row.storageKey);
    if (this.quota) await this.quota.releaseForAttachment(row.id);
    await this.db
      .update(conversationAttachment)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(and(...ownership, eq(conversationAttachment.status, 'deleting')));
  }
}

async function hasValidImageHeader(
  storage: AttachmentStorage,
  key: string,
  contentType: string,
): Promise<boolean> {
  const stream = await storage.open(key);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.from(chunk);
    chunks.push(buffer);
    size += buffer.length;
    if (size >= 16) break;
  }
  const header = Buffer.concat(chunks).subarray(0, 16);
  if (contentType === 'image/png')
    return (
      header.length >= 8 &&
      header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  if (contentType === 'image/jpeg')
    return header.length >= 3 && header.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (contentType === 'image/gif')
    return (
      header.length >= 6 &&
      (header.subarray(0, 6).toString() === 'GIF87a' ||
        header.subarray(0, 6).toString() === 'GIF89a')
    );
  if (contentType === 'image/webp')
    return (
      header.length >= 12 &&
      header.subarray(0, 4).toString() === 'RIFF' &&
      header.subarray(8, 12).toString() === 'WEBP'
    );
  return false;
}

function classify(filename: string, contentType: string): 'image' | 'document' | null {
  const extension = extname(filename).toLowerCase();
  if (IMAGE_TYPES.has(contentType.toLowerCase()) && IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (
    (contentType === 'text/plain' || contentType === 'text/markdown' || !contentType) &&
    TEXT_EXTENSIONS.has(extension)
  )
    return 'document';
  return null;
}

function normalizeContentType(contentType: string, filename: string): string {
  if (contentType) return contentType.toLowerCase();
  return extname(filename).toLowerCase() === '.md' ||
    extname(filename).toLowerCase() === '.markdown'
    ? 'text/markdown'
    : 'text/plain';
}
