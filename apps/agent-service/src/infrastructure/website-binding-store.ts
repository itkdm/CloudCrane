import { eq } from 'drizzle-orm';
import type { PlatformDb } from '@cloudcrane/db';
import { website, workspace } from '@cloudcrane/db';
import type {
  WebsiteBindingStore,
  WebsiteRuntimeBinding,
} from '../application/runtime-registry.js';

export class DrizzleWebsiteBindingStore implements WebsiteBindingStore {
  constructor(private readonly platform: PlatformDb) {}

  async findWebsiteWorkspace(websiteId: string): Promise<WebsiteRuntimeBinding | null> {
    const rows = await this.platform.db
      .select({
        websiteId: website.id,
        websiteStatus: website.status,
        workspaceId: workspace.id,
        workspaceStatus: workspace.status,
        previewPort: workspace.previewPort,
      })
      .from(website)
      .leftJoin(workspace, eq(workspace.websiteId, website.id))
      .where(eq(website.id, websiteId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (!row.workspaceId || !row.workspaceStatus) {
      return {
        websiteId: row.websiteId,
        workspaceId: '00000000-0000-4000-8000-000000000000',
        websiteStatus: row.websiteStatus,
        workspaceStatus: 'missing',
        previewPort: null,
      };
    }
    const workspaceId = row.workspaceId;
    const workspaceStatus = row.workspaceStatus;
    if (!workspaceId || !workspaceStatus) return null;
    return {
      websiteId: row.websiteId,
      websiteStatus: row.websiteStatus,
      workspaceId,
      workspaceStatus,
      previewPort: row.previewPort,
    };
  }
}
