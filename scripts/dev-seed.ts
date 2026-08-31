import { randomUUID } from 'node:crypto';
import { createPlatformDb, website, workspace } from '../packages/db/src/index.js';
import { WorkspaceClient } from '../packages/workspace-client/src/index.js';

const websiteId = randomUUID();
const workspaceId = randomUUID();
const gatewayEndpoint = process.env.WORKSPACE_GATEWAY_ENDPOINT ?? 'http://127.0.0.1:4102';
const gatewayToken = process.env.WORKSPACE_GATEWAY_CLIENT_TOKEN;

const content = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>CloudCrane Real E2E</title>
</head>
<body>
  <main>
    <h1>Hello Before</h1>
    <p>This page is managed by CloudCrane.</p>
  </main>
</body>
</html>
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!gatewayToken) throw new Error('WORKSPACE_GATEWAY_CLIENT_TOKEN is required');

  const platform = createPlatformDb();
  try {
    await platform.db.insert(website).values({
      id: websiteId,
      name: 'CloudCrane Real E2E',
      status: 'active',
      cmsType: 'pbootcms',
    });
    await platform.db.insert(workspace).values({
      id: workspaceId,
      websiteId,
      provider: 'docker',
      status: 'missing',
    });

    const client = new WorkspaceClient(gatewayEndpoint, gatewayToken, { websiteId, workspaceId });
    const runtime = await client.runtime.create();
    const file = await client.fs.write({ path: '/workspace/index.php', content });

    process.stdout.write(
      `${JSON.stringify(
        {
          websiteId,
          workspaceId,
          runtime,
          indexPhpBytes: file.size,
          workbenchUrl: `http://localhost:3000/websites/${websiteId}/agent`,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await platform.pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
