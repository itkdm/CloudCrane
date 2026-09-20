import { eq } from 'drizzle-orm';
import type { PlatformDb } from '@cloudcrane/db';
import { website, workspace } from '@cloudcrane/db';

export type PreviewBinding = {
  websiteId: string;
  previewSlug?: string | null;
  websiteStatus: string;
  workspaceStatus: string;
  previewPort: number | null;
};

export interface PreviewBindingStore {
  find?(websiteId: string): Promise<PreviewBinding | null>;
  findByPreviewSlug?(previewSlug: string): Promise<PreviewBinding | null>;
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
}
