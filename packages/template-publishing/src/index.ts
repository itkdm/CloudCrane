import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { template, workspace, type PlatformDb } from '@cloudcrane/db';
import { parseSnapshotManifest } from '@cloudcrane/pboot-snapshot';
import { WorkspaceClient } from '@cloudcrane/workspace-client';
import { eq } from 'drizzle-orm';

export type TemplatePublishMetadata = {
  name: string;
  description: string;
  category: string;
  demoUrl?: string;
  coverUrl?: string;
};

export type PublishWebsiteTemplateInput = TemplatePublishMetadata & {
  websiteId: string;
  workspaceId: string;
  /** Trusted metadata overrides used by the maintenance CLI, never exposed to Agent tools. */
  versionMetadata?: Partial<{
    sourcePbootVersion: string;
    sourceCoreCommit: string;
    dbSchemaVersion: string;
  }>;
};

export type PublishedTemplate = {
  id: string;
  artifactStorageKey: string;
  artifactSha256: string;
  artifactSize: number;
  sourceWebsiteId: string;
  snapshotSchemaVersion: number;
  sourcePbootVersion: string;
  sourceCoreCommit: string;
  dbEngine: string;
  dbSchemaVersion: string;
};

type Bootstrap = { version?: string; sourceCommit?: string };

export class TemplatePublishingService {
  constructor(
    private readonly platform: PlatformDb,
    private readonly workspaceGatewayEndpoint: string,
    private readonly workspaceGatewayToken: string,
    private readonly artifactRoot: string,
  ) {}

  async publish(input: PublishWebsiteTemplateInput): Promise<PublishedTemplate> {
    const binding = await this.platform.db
      .select({ workspaceId: workspace.id })
      .from(workspace)
      .where(eq(workspace.websiteId, input.websiteId))
      .limit(1);
    if (binding[0]?.workspaceId !== input.workspaceId)
      throw new Error('website workspace binding is invalid');

    const client = new WorkspaceClient(this.workspaceGatewayEndpoint, this.workspaceGatewayToken, {
      websiteId: input.websiteId,
      workspaceId: input.workspaceId,
    });
    const marker = await client.fs.read({
      path: '/workspace/.cloudcrane/bootstrap.json',
      maxBytes: 2_048,
    });
    const bootstrap = parseBootstrap(marker.content);
    const versionMetadata = {
      sourcePbootVersion: input.versionMetadata?.sourcePbootVersion || bootstrap.version,
      sourceCoreCommit: input.versionMetadata?.sourceCoreCommit || bootstrap.sourceCommit,
      dbSchemaVersion: input.versionMetadata?.dbSchemaVersion || bootstrap.version,
    };
    const artifactStorageKey = `template-${randomUUID()}.zip`;
    const staged = await client.snapshot.stage({
      artifactStorageKey,
      sourceWebsiteId: input.websiteId,
      sourcePbootVersion: versionMetadata.sourcePbootVersion,
      sourceCoreCommit: versionMetadata.sourceCoreCommit,
      dbSchemaVersion: versionMetadata.dbSchemaVersion,
    });
    const manifest = parseSnapshotManifest(staged.manifest);
    const id = randomUUID();
    try {
      await this.platform.db.insert(template).values({
        id,
        sourceWebsiteId: input.websiteId,
        name: input.name,
        description: input.description,
        category: input.category,
        coverUrl: input.coverUrl,
        demoUrl: input.demoUrl,
        cmsType: 'pbootcms',
        artifactStorageKey: staged.artifactStorageKey,
        artifactSha256: staged.artifactSha256,
        artifactSize: staged.artifactSize,
        artifactType: manifest.artifactType,
        snapshotSchemaVersion: manifest.snapshotSchemaVersion,
        sourcePbootVersion: manifest.sourcePbootVersion,
        sourceCoreCommit: manifest.sourceCoreCommit,
        dbEngine: manifest.dbEngine,
        dbSchemaVersion: manifest.dbSchemaVersion,
        status: 'published',
        publishedAt: new Date(),
      });
    } catch (error) {
      await rm(path.join(this.artifactRoot, staged.artifactStorageKey), { force: true }).catch(
        () => undefined,
      );
      throw error;
    }
    return {
      id,
      artifactStorageKey: staged.artifactStorageKey,
      artifactSha256: staged.artifactSha256,
      artifactSize: staged.artifactSize,
      sourceWebsiteId: input.websiteId,
      snapshotSchemaVersion: manifest.snapshotSchemaVersion,
      sourcePbootVersion: manifest.sourcePbootVersion,
      sourceCoreCommit: manifest.sourceCoreCommit,
      dbEngine: manifest.dbEngine,
      dbSchemaVersion: manifest.dbSchemaVersion,
    };
  }
}

function parseBootstrap(content: string): { version: string; sourceCommit: string } {
  let value: Bootstrap;
  try {
    value = JSON.parse(content) as Bootstrap;
  } catch {
    throw new Error('website bootstrap metadata is invalid');
  }
  if (!value.version || !value.sourceCommit)
    throw new Error('website bootstrap metadata is incomplete');
  return { version: value.version, sourceCommit: value.sourceCommit };
}
