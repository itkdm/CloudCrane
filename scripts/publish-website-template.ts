import path from 'node:path';
import { createPlatformDb, workspace } from '@cloudcrane/db';
import { TemplatePublishingService } from '@cloudcrane/template-publishing';
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
    const published = await new TemplatePublishingService(
      platform,
      endpoint,
      token,
      artifactRoot,
    ).publish({
      websiteId,
      workspaceId,
      name,
      description,
      category,
      coverUrl: values.get('cover-url'),
      demoUrl: values.get('demo-url'),
      versionMetadata: {
        sourcePbootVersion: values.get('source-pboot-version') ?? '',
        sourceCoreCommit: values.get('source-core-commit') ?? '',
        dbSchemaVersion: values.get('db-schema-version') ?? '',
      },
    });
    process.stdout.write(
      JSON.stringify({
        id: published.id,
        artifactStorageKey: published.artifactStorageKey,
        artifactSha256: published.artifactSha256,
        artifactSize: published.artifactSize,
      }) + '\n',
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
  for (const arg of args[0] === '--' ? args.slice(1) : args) {
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
