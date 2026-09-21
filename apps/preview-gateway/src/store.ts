import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PlatformDb } from '@cloudcrane/db';
import { website, websiteShare, workspace } from '@cloudcrane/db';

export type PreviewBinding = {
  websiteId: string;
  previewSlug?: string | null;
  websiteStatus: string;
  workspaceStatus: string;
  previewPort: number | null;
};

export type PreviewShare = {
  id: string;
  websiteId: string;
  expiresAt: Date;
};

export interface PreviewBindingStore {
  find?(websiteId: string): Promise<PreviewBinding | null>;
  findByPreviewSlug?(previewSlug: string): Promise<PreviewBinding | null>;
  findShareByTokenHash?(tokenHash: string): Promise<PreviewShare | null>;
  recordShareAccess?(shareId: string): Promise<PreviewShare | null>;
}

export class DrizzlePreviewBindingStore implements PreviewBindingStore {
  constructor(private readonly platform: PlatformDb) {}

  async find(websiteId: string): Promise<PreviewBinding | null> {
    const rows = await this.platform.db
      .select({
        websiteId: website.id,
        previewSlug: website.previewSlug,
        websiteStatus: website.status,
        workspaceStatus: workspace.status,
        previewPort: workspace.previewPort,
      })
      .from(website)
      .leftJoin(workspace, eq(workspace.websiteId, website.id))
      .where(eq(website.id, websiteId))
      .limit(1);
    const row = rows[0];
    return row ? { ...row, workspaceStatus: row.workspaceStatus ?? 'missing' } : null;
  }

  async findByPreviewSlug(previewSlug: string): Promise<PreviewBinding | null> {
    const rows = await this.platform.db
      .select({
        websiteId: website.id,
        previewSlug: website.previewSlug,
        websiteStatus: website.status,
        workspaceStatus: workspace.status,
        previewPort: workspace.previewPort,
      })
      .from(website)
      .leftJoin(workspace, eq(workspace.websiteId, website.id))
      .where(eq(website.previewSlug, previewSlug))
      .limit(1);
    const row = rows[0];
    return row ? { ...row, workspaceStatus: row.workspaceStatus ?? 'missing' } : null;
  }

  async findShareByTokenHash(tokenHash: string): Promise<PreviewShare | null> {
    const rows = await this.platform.db
      .select({
        id: websiteShare.id,
        websiteId: websiteShare.websiteId,
        expiresAt: websiteShare.expiresAt,
      })
      .from(websiteShare)
      .where(
        and(
          eq(websiteShare.tokenHash, tokenHash),
          isNull(websiteShare.revokedAt),
          gt(websiteShare.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async recordShareAccess(shareId: string): Promise<PreviewShare | null> {
    const rows = await this.platform.db
      .update(websiteShare)
      .set({
        lastAccessAt: sql`now()`,
        accessCount: sql`${websiteShare.accessCount} + 1`,
      })
      .where(
        and(
          eq(websiteShare.id, shareId),
          isNull(websiteShare.revokedAt),
          gt(websiteShare.expiresAt, sql`now()`),
        ),
      )
      .returning({
        id: websiteShare.id,
        websiteId: websiteShare.websiteId,
        expiresAt: websiteShare.expiresAt,
      });
    return rows[0] ?? null;
  }
}
