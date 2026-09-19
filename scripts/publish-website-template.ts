import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { createPlatformDb, template, workspace } from '@cloudcrane/db';
import { parseSnapshotManifest } from '@cloudcrane/pboot-snapshot';
import { WorkspaceClient } from '@cloudcrane/workspace-client';
import { eq } from 'drizzle-orm';

const values = parseArgs(process.argv.slice(2));
async function main(): Promise<void> {
  const websiteId = required('website-id');
  const name = required('name');
  const description = required('description');
  const category = required('category');
  const endpoint = process.env.WORKSPACE_GATEWAY_ENDPOINT;
  const token = process.env.WORKSPACE_GATEWAY_CLIENT_TOKEN;
  if (!endpoint || !token) throw new Error('workspace gateway configuration is required');

  const platform = createPlatformDb();
  const artifactRoot = path.resolve(
    process.env.TEMPLATE_ARTIFACT_ROOT ?? '.cloudcrane-data/templates',
  );
  try {
    const rows = await platform.db
      .select({ workspaceId: workspace.id })
      .from(workspace)
      .where(eq(workspace.websiteId, websiteId))
      .limit(1);
    const workspaceId = rows[0]?.workspaceId;
    if (!workspaceId) throw new Error('website workspace was not found');
    const client = new WorkspaceClient(endpoint, token, { websiteId, workspaceId });
    const marker = await client.fs.read({
      path: '/workspace/.cloudcrane/bootstrap.json',
      maxBytes: 2_048,
    });
    const bootstrap = JSON.parse(marker.content) as { version?: string; sourceCommit?: string };
    const sourcePbootVersion = values.get('source-pboot-version') ?? bootstrap.version;
    const sourceCoreCommit = values.get('source-core-commit') ?? bootstrap.sourceCommit;
    const dbSchemaVersion = values.get('db-schema-version') ?? sourcePbootVersion;
    if (!sourcePbootVersion || !sourceCoreCommit || !dbSchemaVersion)
      throw new Error('snapshot version metadata is incomplete');
    const artifactStorageKey = `template-${randomUUID()}.zip`;
    const staged = await client.snapshot.stage({
      artifactStorageKey,
      sourceWebsiteId: websiteId,
      sourcePbootVersion,
      sourceCoreCommit,
      dbSchemaVersion,
    });
    const manifest = parseSnapshotManifest(staged.manifest);
    const id = randomUUID();
    try {
      await platform.db.insert(template).values({
        id,
        sourceWebsiteId: websiteId,
        name,
        description,
        category,
        coverUrl: values.get('cover-url'),
        demoUrl: values.get('demo-url'),
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
      await rm(path.join(artifactRoot, staged.artifactStorageKey), { force: true }).catch(
        () => undefined,
      );
      throw error;
    }
    console.log(
      JSON.stringify({
        id,
        artifactStorageKey: staged.artifactStorageKey,
        artifactSha256: staged.artifactSha256,
        artifactSize: staged.artifactSize,
      }),
    );
  } finally {
    await platform.pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'template publish failed'}\n`);
  process.exitCode = 1;
});

function parseArgs(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match || !match[1] || match[2] === undefined)
      throw new Error(`argument must use --key=value: ${arg}`);
    result.set(match[1], match[2]);
  }
  return result;
}

function required(key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`missing --${key}`);
  return value;
}
