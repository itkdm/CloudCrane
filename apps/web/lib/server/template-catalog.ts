import { and, asc, eq } from 'drizzle-orm';
import { createPlatformDb, template } from '@cloudcrane/db';

export const TEMPLATE_PUBLISHED = 'published';
export const TEMPLATE_ATTACHMENT_PENDING = 'pending';
export const TEMPLATE_ATTACHMENT_MATERIALIZING = 'materializing';
export const TEMPLATE_ATTACHMENT_READY = 'ready';
export const TEMPLATE_ATTACHMENT_FAILED = 'failed';

export type PublicTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  coverUrl: string | null;
  demoUrl: string | null;
  cmsType: string;
};

export type TemplateSnapshot = PublicTemplate & {
  artifactStorageKey: string;
  artifactSha256: string;
  artifactSize: number;
  artifactType: string;
  snapshotSchemaVersion: number | null;
  sourcePbootVersion: string | null;
  sourceCoreCommit: string | null;
  dbEngine: string | null;
  dbSchemaVersion: string | null;
};

export type StoredTemplate = TemplateSnapshot & { status: string };

export function toPublicTemplate(row: TemplateSnapshot): PublicTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    coverUrl: row.coverUrl,
    demoUrl: row.demoUrl,
    cmsType: row.cmsType,
  };
}

export function createTemplateCatalog() {
  const platform = createPlatformDb();
  // Keep this adapter local until the DB package exposes typed query clients to the app package.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = platform.db;
  return {
    platform,
    async listPublished(category?: string): Promise<PublicTemplate[]> {
      const rows = await db
        .select({
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          coverUrl: template.coverUrl,
          demoUrl: template.demoUrl,
          cmsType: template.cmsType,
        })
        .from(template)
        .where(
          category
            ? and(
                eq(template.status as never, TEMPLATE_PUBLISHED),
                eq(template.category as never, category),
              )
            : eq(template.status as never, TEMPLATE_PUBLISHED),
        )
        .orderBy(asc(template.sortOrder as never), asc(template.createdAt as never));
      return rows;
    },
    async findPublished(id: string): Promise<TemplateSnapshot | null> {
      const rows = await db
        .select({
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          coverUrl: template.coverUrl,
          demoUrl: template.demoUrl,
          cmsType: template.cmsType,
          artifactStorageKey: template.artifactStorageKey,
          artifactSha256: template.artifactSha256,
          artifactSize: template.artifactSize,
          artifactType: template.artifactType,
          snapshotSchemaVersion: template.snapshotSchemaVersion,
          sourcePbootVersion: template.sourcePbootVersion,
          sourceCoreCommit: template.sourceCoreCommit,
          dbEngine: template.dbEngine,
          dbSchemaVersion: template.dbSchemaVersion,
        })
        .from(template)
        .where(and(eq(template.id as never, id), eq(template.status as never, TEMPLATE_PUBLISHED)))
        .limit(1);
      return rows[0] ?? null;
    },
    async findById(id: string): Promise<StoredTemplate | null> {
      const rows = await db
        .select({
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          coverUrl: template.coverUrl,
          demoUrl: template.demoUrl,
          cmsType: template.cmsType,
          artifactStorageKey: template.artifactStorageKey,
          artifactSha256: template.artifactSha256,
          artifactSize: template.artifactSize,
          artifactType: template.artifactType,
          snapshotSchemaVersion: template.snapshotSchemaVersion,
          sourcePbootVersion: template.sourcePbootVersion,
          sourceCoreCommit: template.sourceCoreCommit,
          dbEngine: template.dbEngine,
          dbSchemaVersion: template.dbSchemaVersion,
          status: template.status,
        })
        .from(template)
        .where(eq(template.id as never, id))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
