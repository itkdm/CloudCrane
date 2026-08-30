import { mkdtemp, readFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Model,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createPlatformDb, website, websiteSession, workspace } from '@cloudcrane/db';
import { WorkspaceClient } from '@cloudcrane/workspace-client';
import { WebsiteAgentRuntime, type WorkspaceClientFactory } from '@cloudcrane/website-agent';
import { DrizzleWebsiteAgentStore } from './infrastructure/website-agent-store.js';

const enabled = process.env.CLOUDCRANE_AGENT_RUNTIME_INTEGRATION === '1';
const websiteId = '00000000-0000-4000-8000-000000000501';
const workspaceId = '00000000-0000-4000-8000-000000000502';
const runnerId = '00000000-0000-4000-8000-000000000503';
const clientToken = 'agent-runtime-client-token';
const runnerToken = 'agent-runtime-runner-token';
const port = 4104;
const platform = process.env.DATABASE_URL ? createPlatformDb() : undefined;
let gateway: ChildProcess | undefined;
let runner: ChildProcess | undefined;

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* process is still starting */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

describe.skipIf(!enabled)('WebsiteAgentRuntime over the real CloudCrane stack', () => {
  beforeAll(async () => {
    if (!platform) throw new Error('DATABASE_URL is required');
    await platform.db
      .insert(website)
      .values({
        id: websiteId,
        name: 'agent-runtime-integration',
        status: 'active',
        cmsType: 'pbootcms',
      })
      .onConflictDoNothing();
    await platform.db
      .insert(workspace)
      .values({ id: workspaceId, websiteId, provider: 'docker', status: 'missing' })
      .onConflictDoNothing();
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      WORKSPACE_GATEWAY_CLIENT_TOKEN: clientToken,
      RUNNER_AUTH_TOKEN: runnerToken,
      WORKSPACE_GATEWAY_PORT: String(port),
      WORKSPACE_GATEWAY_HEARTBEAT_INTERVAL_MS: '500',
      WORKSPACE_GATEWAY_OFFLINE_TIMEOUT_MS: '1500',
      WORKSPACE_ROOT: '/tmp/cloudcrane-agent-runtime-workspaces',
      WORKSPACE_IMAGE: 'website-workspace-pboot:v1',
      RUNNER_ID: runnerId,
      WORKSPACE_GATEWAY_RUNNER_URL: `ws://127.0.0.1:${port}/v1/runners/connect`,
    };
    gateway = spawn(process.execPath, [path.resolve('../workspace-gateway/dist/index.js')], {
      env,
      stdio: 'ignore',
    });
    await waitFor(`http://127.0.0.1:${port}/health`);
    runner = spawn(process.execPath, [path.resolve('../runner/dist/index.js')], {
      env,
      stdio: 'ignore',
    });
    const probe = new WorkspaceClient(`http://127.0.0.1:${port}`, clientToken, {
      websiteId,
      workspaceId,
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await probe.runtime.status();
        return;
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
    throw new Error('timed out waiting for agent runtime runner registration');
  }, 60_000);

  afterAll(async () => {
    runner?.kill();
    gateway?.kill();
    await platform?.pool.end();
  }, 30_000);

  it('drives remote read/write/edit/bash through a real prompt and records run context', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-agent-runtime-'));
    const faux = fauxProvider({
      provider: 'cloudcrane-integration',
      models: [{ id: 'deterministic' }],
    });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('write', { path: '/workspace/runtime.txt', content: 'hello pi' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxToolCall('read', { path: '/workspace/runtime.txt' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('bash', { command: 'printf bash-ok' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage(
        [
          fauxToolCall('edit', {
            path: '/workspace/runtime.txt',
            edits: [{ oldText: 'pi', newText: 'CloudCrane' }],
          }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('agent runtime completed'),
    ]);
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const requestBodies: Array<{
      traceId?: string;
      agentRunId?: string;
      operation?: string;
      payload?: { env?: Record<string, string> };
    }> = [];
    const baseClient = new WorkspaceClient(`http://127.0.0.1:${port}`, clientToken, {
      websiteId,
      workspaceId,
    });
    const factory: WorkspaceClientFactory = (contextProvider) =>
      new WorkspaceClient(
        `http://127.0.0.1:${port}`,
        clientToken,
        { websiteId, workspaceId },
        async (input, init) => {
          const body = JSON.parse(String(init?.body)) as {
            traceId?: string;
            agentRunId?: string;
            operation?: string;
            payload?: { env?: Record<string, string> };
          };
          requestBodies.push({
            traceId: body.traceId,
            agentRunId: body.agentRunId,
            operation: body.operation,
            payload: body.payload,
          });
          return fetch(input, init);
        },
        contextProvider,
      );
    const store = new DrizzleWebsiteAgentStore(platform!);
    const runtime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: `http://127.0.0.1:${port}`,
      workspaceClientToken: clientToken,
      agentDataRoot: dataRoot,
      store,
      modelRuntime,
      model: faux.getModel() as Model<'cloudcrane-integration'>,
      workspaceClientFactory: factory,
    });
    const session = await runtime.createSession();
    const result = await runtime.prompt(session.id, 'Update the website file and verify it.');
    expect(result.status).toBe('COMPLETED');
    expect(
      requestBodies.filter((body) => body.agentRunId === result.runId).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      new Set(
        requestBodies
          .filter((body) => body.agentRunId === result.runId)
          .map((body) => body.traceId),
      ),
    ).toEqual(new Set([result.traceId]));
    const processRequests = requestBodies.filter(
      (body) => body.agentRunId === result.runId && body.operation === 'process.exec',
    );
    expect(processRequests.length).toBeGreaterThanOrEqual(1);
    expect(processRequests.every((body) => !body.payload?.env?.DATABASE_URL)).toBe(true);
    expect(processRequests.every((body) => !body.payload?.env?.OPENAI_API_KEY)).toBe(true);
    await expect(baseClient.fs.read({ path: '/workspace/runtime.txt' })).resolves.toMatchObject({
      content: 'hello CloudCrane',
    });
    const jsonl = await readFile(
      path.join(dataRoot, session.sessionFile.split('/').join(path.sep)),
      'utf8',
    );
    expect(jsonl).toContain('agent runtime completed');
    const indexed = await platform!.db
      .select()
      .from(websiteSession)
      .where(eq(websiteSession.id, session.id));
    expect(indexed[0]?.sessionFile).toBe(session.sessionFile);
    await runtime.disposeAll();
  }, 120_000);

  it('surfaces FILE_CHANGED and aborts a remote long command through Pi', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-agent-runtime-failure-'));
    const faux = fauxProvider({
      provider: 'cloudcrane-failure',
      models: [{ id: 'deterministic' }],
    });
    const api = new WorkspaceClient(`http://127.0.0.1:${port}`, clientToken, {
      websiteId,
      workspaceId,
    });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('write', { path: '/workspace/conflict.txt', content: 'original' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxToolCall('read', { path: '/workspace/conflict.txt' })], {
        stopReason: 'toolUse',
      }),
      async () => {
        await api.fs.write({ path: '/workspace/conflict.txt', content: 'outside-change' });
        return fauxAssistantMessage(
          [
            fauxToolCall('edit', {
              path: '/workspace/conflict.txt',
              edits: [{ oldText: 'original', newText: 'agent-change' }],
            }),
          ],
          { stopReason: 'toolUse' },
        );
      },
      fauxAssistantMessage('conflict handled'),
    ]);
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const runtime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: `http://127.0.0.1:${port}`,
      workspaceClientToken: clientToken,
      agentDataRoot: dataRoot,
      store: new DrizzleWebsiteAgentStore(platform!),
      modelRuntime,
      model: faux.getModel() as Model<'cloudcrane-failure'>,
    });
    const session = await runtime.createSession();
    const conflict = await runtime.prompt(session.id, 'Change the conflict file.');
    expect(conflict.status).toBe('COMPLETED');
    await expect(api.fs.read({ path: '/workspace/conflict.txt' })).resolves.toMatchObject({
      content: 'outside-change',
    });

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('bash', { command: 'sleep 30' })], {
        stopReason: 'toolUse',
      }),
    ]);
    const longRun = runtime.prompt(session.id, 'Run the long command.');
    setTimeout(() => void runtime.abort(session.id), 500);
    await expect(longRun).resolves.toMatchObject({ status: 'ABORTED' });
    await runtime.disposeAll();
  }, 120_000);
});
