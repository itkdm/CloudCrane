import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPlatformDb, website, workspace } from '@cloudcrane/db';
import { WorkspaceClient } from '@cloudcrane/workspace-client';

const enabled = process.env.CLOUDCRANE_REMOTE_INTEGRATION === '1';
const websiteId = '00000000-0000-4000-8000-000000000101';
const workspaceId = '00000000-0000-4000-8000-000000000102';
const runnerId = '00000000-0000-4000-8000-000000000103';
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

async function waitForRunnerOnline() {
  const probe = new WorkspaceClient('http://127.0.0.1:4102', token, { websiteId, workspaceId });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await probe.runtime.status();
      return;
    } catch (error) {
      if (error instanceof Error && !error.message.includes('no online runner')) return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('timed out waiting for runner registration');
}

describe.skipIf(!enabled)('remote execution over real Gateway and Runner processes', () => {
  beforeAll(async () => {
    if (!platform) throw new Error('DATABASE_URL is required');
    await platform.db
      .insert(website)
      .values({ id: websiteId, name: 'integration', status: 'active', cmsType: 'pbootcms' })
      .onConflictDoNothing();
    await platform.db
      .insert(workspace)
      .values({ id: workspaceId, websiteId, provider: 'docker', status: 'missing' })
      .onConflictDoNothing();
    const env = {
      ...process.env,
      WORKSPACE_GATEWAY_CLIENT_TOKEN: token,
      RUNNER_AUTH_TOKEN: token,
      WORKSPACE_GATEWAY_PORT: '4102',
      WORKSPACE_GATEWAY_HEARTBEAT_INTERVAL_MS: '500',
      WORKSPACE_GATEWAY_OFFLINE_TIMEOUT_MS: '1500',
      WORKSPACE_ROOT: '/tmp/cloudcrane-workspaces',
      WORKSPACE_IMAGE: 'website-workspace-pboot:v1',
      RUNNER_ID: runnerId,
      WORKSPACE_GATEWAY_RUNNER_URL: 'ws://127.0.0.1:4102/v1/runners/connect',
    };
    gateway = spawn(process.execPath, [resolve('dist/index.js')], { env, stdio: 'ignore' });
    await waitFor('http://127.0.0.1:4102/health');
    runner = spawn(process.execPath, [resolve('../runner/dist/index.js')], {
      env,
      stdio: 'ignore',
    });
    await waitForRunnerOnline();
  }, 45_000);

  afterAll(async () => {
    try {
      await client().runtime.destroy({ idempotencyKey: 'integration-destroy' });
    } catch {
      /* cleanup is best effort */
    }
    runner?.kill();
    gateway?.kill();
    await platform?.pool.end();
  });

  const client = () =>
    new WorkspaceClient('http://127.0.0.1:4102', token, { websiteId, workspaceId });

  it('executes runtime, filesystem, process, relationship guard, and reconnect flow', async () => {
    const api = client();
    await expect(
      api.runtime.create({ idempotencyKey: 'integration-create' }),
    ).resolves.toMatchObject({ workspaceId });
    const bound = await platform!.db
      .select({ runnerId: workspace.runnerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId));
    expect(bound[0]?.runnerId).toBe(runnerId);
    await expect(
      api.fs.write(
        { path: 'hello.txt', content: 'hello cloudcrane' },
        { idempotencyKey: 'integration-write' },
      ),
    ).resolves.toMatchObject({ size: 15 });
    await expect(api.fs.read({ path: 'hello.txt' })).resolves.toMatchObject({
      content: 'hello cloudcrane',
    });
    await expect(
      api.process.exec({
        command: 'php',
        args: ['-r', 'echo "ok";'],
        executionId: '00000000-0000-4000-8000-000000000104',
      }),
    ).resolves.toMatchObject({ stdout: 'ok', status: 'completed' });
    await expect(api.runtime.stop({ idempotencyKey: 'integration-stop' })).resolves.toMatchObject({
      status: 'stopped',
    });
    await expect(api.runtime.start({ idempotencyKey: 'integration-start' })).resolves.toMatchObject(
      { status: 'running' },
    );
    const mismatch = new WorkspaceClient('http://127.0.0.1:4102', token, {
      websiteId: '00000000-0000-4000-8000-000000000105',
      workspaceId,
    });
    await expect(mismatch.fs.read({ path: 'hello.txt' })).rejects.toMatchObject({
      code: 'WEBSITE_WORKSPACE_MISMATCH',
    });
    runner?.kill();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    runner = spawn(process.execPath, [resolve('../runner/dist/index.js')], {
      env: {
        ...process.env,
        WORKSPACE_GATEWAY_RUNNER_URL: 'ws://127.0.0.1:4102/v1/runners/connect',
        RUNNER_AUTH_TOKEN: token,
        RUNNER_ID: runnerId,
        WORKSPACE_ROOT: '/tmp/cloudcrane-workspaces',
        WORKSPACE_IMAGE: 'website-workspace-pboot:v1',
      },
      stdio: 'ignore',
    });
    await waitForRunnerOnline();
    await expect(api.fs.read({ path: 'hello.txt' })).resolves.toMatchObject({
      content: 'hello cloudcrane',
    });
  }, 120_000);
});
