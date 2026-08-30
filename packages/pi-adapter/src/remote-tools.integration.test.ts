import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPlatformDb, website, workspace } from '@cloudcrane/db';
import { WorkspaceClient } from '@cloudcrane/workspace-client';
import { createCloudCraneCodingTools } from './index.js';

const enabled = process.env.CLOUDCRANE_REMOTE_INTEGRATION === '1';
const websiteId = '00000000-0000-4000-8000-000000000401';
const workspaceId = '00000000-0000-4000-8000-000000000402';
const runnerId = '00000000-0000-4000-8000-000000000403';
const token = 'integration-token';
let gateway: ChildProcess | undefined;
let runner: ChildProcess | undefined;
const platform = process.env.DATABASE_URL ? createPlatformDb() : undefined;

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* process is still starting */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

const client = () =>
  new WorkspaceClient('http://127.0.0.1:4103', token, { websiteId, workspaceId });

async function waitForRunnerOnline() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await client().runtime.status();
      return;
    } catch (error) {
      if (error instanceof Error && !error.message.includes('no online runner')) return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('timed out waiting for runner registration');
}

describe.skipIf(!enabled)('Pi coding tools over real Gateway, Runner, Docker, and Daemon', () => {
  beforeAll(async () => {
    if (!platform) throw new Error('DATABASE_URL is required');
    await platform.db
      .insert(website)
      .values({ id: websiteId, name: 'pi-integration', status: 'active', cmsType: 'pbootcms' })
      .onConflictDoNothing();
    await platform.db
      .insert(workspace)
      .values({ id: workspaceId, websiteId, provider: 'docker', status: 'missing' })
      .onConflictDoNothing();
    const env = {
      ...process.env,
      WORKSPACE_GATEWAY_CLIENT_TOKEN: token,
      RUNNER_AUTH_TOKEN: token,
      WORKSPACE_GATEWAY_PORT: '4103',
      WORKSPACE_GATEWAY_HEARTBEAT_INTERVAL_MS: '500',
      WORKSPACE_GATEWAY_OFFLINE_TIMEOUT_MS: '1500',
      WORKSPACE_ROOT: '/tmp/cloudcrane-pi-workspaces',
      WORKSPACE_IMAGE: 'website-workspace-pboot:v1',
      RUNNER_ID: runnerId,
      WORKSPACE_GATEWAY_RUNNER_URL: 'ws://127.0.0.1:4103/v1/runners/connect',
    };
    gateway = spawn(process.execPath, [resolve('../../apps/workspace-gateway/dist/index.js')], {
      env,
      stdio: 'ignore',
    });
    await waitFor('http://127.0.0.1:4103/health');
    runner = spawn(process.execPath, [resolve('../../apps/runner/dist/index.js')], {
      env,
      stdio: 'ignore',
    });
    await waitForRunnerOnline();
  }, 45_000);

  afterAll(async () => {
    try {
      await client().runtime.destroy({ idempotencyKey: 'pi-integration-destroy' });
    } catch {
      /* cleanup is best effort */
    }
    runner?.kill();
    gateway?.kill();
    await platform?.pool.end();
  }, 30_000);

  it('runs actual Pi read, write, edit, ls, find, and bash definitions', async () => {
    const api = client();
    await api.runtime.create({ idempotencyKey: 'pi-integration-create' });
    const tools = createCloudCraneCodingTools({ workspaceClient: api });
    await tools.write.execute(
      'pi-write',
      { path: '/workspace/pi.txt', content: 'hello from pi' },
      undefined,
      undefined,
      undefined as never,
    );
    const read = await tools.read.execute(
      'pi-read',
      { path: '/workspace/pi.txt' },
      undefined,
      undefined,
      undefined as never,
    );
    expect(read.content).toEqual([{ type: 'text', text: 'hello from pi' }]);
    await tools.edit.execute(
      'pi-edit',
      { path: '/workspace/pi.txt', edits: [{ oldText: 'pi', newText: 'CloudCrane' }] },
      undefined,
      undefined,
      undefined as never,
    );
    const listed = await tools.ls.execute(
      'pi-ls',
      { path: '/workspace' },
      undefined,
      undefined,
      undefined as never,
    );
    expect(listed.content[0]).toMatchObject({ type: 'text' });
    const found = await tools.find.execute(
      'pi-find',
      { pattern: '*.txt', path: '/workspace' },
      undefined,
      undefined,
      undefined as never,
    );
    expect(found.content[0]).toMatchObject({ type: 'text' });
    const bash = await tools.bash.execute(
      'pi-bash',
      { command: 'printf bash-ok' },
      undefined,
      undefined,
      undefined as never,
    );
    expect(bash.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('bash-ok'),
    });
    const stored = await api.fs.read({ path: '/workspace/pi.txt' });
    expect(stored.content).toBe('hello from CloudCrane');
    const binding = await platform!.db
      .select({ runnerId: workspace.runnerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId));
    expect(binding[0]?.runnerId).toBe(runnerId);
  }, 120_000);
});
