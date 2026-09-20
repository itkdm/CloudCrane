import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  finishAuditEvent,
  insertAuditEvent,
  template,
  workspace,
  type PlatformDb,
} from '@cloudcrane/db';
import { parseSnapshotManifest } from '@cloudcrane/pboot-snapshot';
import { WorkspaceClient, WorkspaceClientError } from '@cloudcrane/workspace-client';
import { getActiveTraceContext } from '@cloudcrane/shared';
import { eq } from 'drizzle-orm';

export type TemplatePublishMetadata = {
  name: string;
  description: string;
  category: string;
  demoUrl?: string;
  coverUrl?: string;
  agentRunId?: string;
  runCorrelationId?: string;
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

    const startedAt = Date.now();
    let auditId: string;
    let artifactStorageKey: string | undefined;
    let templateInserted = false;
    let operationCompleted = false;
    try {
      const traceContext = getActiveTraceContext();
      auditId = await insertAuditEvent(this.platform.db, {
        actorType: 'agent',
        operation: 'template.publish',
        resourceType: 'website',
        resourceRef: input.websiteId,
        websiteId: input.websiteId,
        workspaceId: input.workspaceId,
        agentRunId: input.agentRunId,
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        runCorrelationId: input.runCorrelationId,
        status: 'PENDING',
        requestSummary: {
          nameLength: input.name.length,
          descriptionLength: input.description.length,
          categoryLength: input.category.length,
          hasDemoUrl: Boolean(input.demoUrl),
          hasCoverUrl: Boolean(input.coverUrl),
        },
      });
    } catch {
      throw new Error('template publish audit is unavailable');
    }

    try {
      const client = new WorkspaceClient(
        this.workspaceGatewayEndpoint,
        this.workspaceGatewayToken,
        {
          websiteId: input.websiteId,
          workspaceId: input.workspaceId,
          traceId: input.runCorrelationId,
          agentRunId: input.agentRunId,
        },
      );
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
      artifactStorageKey = `template-${randomUUID()}.zip`;
      const staged = await client.snapshot.stage({
        artifactStorageKey,
        sourceWebsiteId: input.websiteId,
        sourcePbootVersion: versionMetadata.sourcePbootVersion,
        sourceCoreCommit: versionMetadata.sourceCoreCommit,
        dbSchemaVersion: versionMetadata.dbSchemaVersion,
      });
      const manifest = parseSnapshotManifest(staged.manifest);
      const id = randomUUID();
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
      templateInserted = true;
      operationCompleted = true;
      const published = {
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
      } satisfies PublishedTemplate;
      await finishAuditEvent(this.platform.db, auditId, {
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        resultSummary: { artifactSize: published.artifactSize },
      });
      return published;
    } catch (error) {
      if (!templateInserted && artifactStorageKey)
        await rm(path.join(this.artifactRoot, artifactStorageKey), { force: true }).catch(
          () => undefined,
        );
      if (operationCompleted) {
        try {
          await finishAuditEvent(this.platform.db, auditId, {
            status: 'UNKNOWN',
            durationMs: Date.now() - startedAt,
            errorCode: 'AUDIT_FINALIZATION_FAILED',
          });
        } catch {
          // The template commit point already succeeded; never rewrite it as FAILED.
        }
        throw error;
      }
      try {
        const auditStatus =
          error instanceof WorkspaceClientError &&
          ['UNKNOWN_RESULT', 'REQUEST_TIMEOUT', 'ABORTED'].includes(error.code)
            ? 'UNKNOWN'
            : 'FAILED';
        await finishAuditEvent(this.platform.db, auditId, {
          status: auditStatus,
          durationMs: Date.now() - startedAt,
          errorCode: error instanceof Error ? undefined : 'TEMPLATE_PUBLISH_FAILED',
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        });
      } catch {
        throw new Error('template publish audit finalization failed');
      }
      throw error;
    }
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
