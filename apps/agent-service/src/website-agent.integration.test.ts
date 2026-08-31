import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseStep,
  type Model,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  agentRun,
  createPlatformDb,
  runner as runnerTable,
  website,
  websiteSession,
  workspace,
} from '@cloudcrane/db';
import { WorkspaceClient } from '@cloudcrane/workspace-client';
import { WebsiteAgentRuntime, type WorkspaceClientFactory } from '@cloudcrane/website-agent';
import type {
  AgentWireMessage,
  PreviewCapability,
  PreviewObservation,
} from '@cloudcrane/agent-protocol';
import { ClientPreviewProvider } from './infrastructure/client-preview-provider.js';
import { PreviewClientRegistry } from './infrastructure/preview-client-registry.js';
import { DrizzleWebsiteAgentStore } from './infrastructure/website-agent-store.js';
import { buildAgentServiceApp } from './app.js';
import { WebsiteRuntimeRegistry } from './application/runtime-registry.js';

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
let previewGateway: ChildProcess | undefined;
let probe: WorkspaceClient | undefined;
let previewPort: number;
const agentDataRoots: string[] = [];
const childLogs = new Map<ChildProcess, string[]>();

function trackChild(child: ChildProcess, label: string): void {
  const lines: string[] = [];
  childLogs.set(child, lines);
  const append = (chunk: Buffer | string) => {
    lines.push(
      ...`${chunk}`
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => `${label}: ${line}`),
    );
    if (lines.length > 40) lines.splice(0, lines.length - 40);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
}

function diagnostics(): string {
  return [...childLogs.values()].flat().join('\n');
}

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* process is still starting */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`timed out waiting for ${url}\n${diagnostics()}`);
}

async function waitForRunnerRegistered(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = await platform!.db
      .select({ status: runnerTable.status })
      .from(runnerTable)
      .where(eq(runnerTable.id, runnerId))
      .limit(1);
    if (rows[0]?.status === 'online') return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`timed out waiting for runner ${runnerId} registration\n${diagnostics()}`);
}

async function terminate(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
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
      .onConflictDoUpdate({
        target: workspace.id,
        set: {
          runnerId: null,
          status: 'missing',
          containerRef: null,
          previewPort: null,
          updatedAt: new Date(),
        },
      });
    await platform.db
      .update(runnerTable)
      .set({ status: 'offline', lastHeartbeatAt: null, updatedAt: new Date() })
      .where(eq(runnerTable.id, runnerId));
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
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackChild(gateway, 'gateway');
    await waitFor(`http://127.0.0.1:${port}/health`);
    runner = spawn(process.execPath, [path.resolve('../runner/dist/index.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackChild(runner, 'runner');
    await waitForRunnerRegistered();
    probe = new WorkspaceClient(`http://127.0.0.1:${port}`, clientToken, {
      websiteId,
      workspaceId,
    });
    await probe.runtime.create();
    const binding = await platform.db
      .select({ previewPort: workspace.previewPort })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    previewPort = binding[0]?.previewPort ?? 0;
    if (!previewPort) throw new Error('workspace preview port was not persisted');
    previewGateway = spawn(process.execPath, [path.resolve('../preview-gateway/dist/index.js')], {
      env: {
        ...env,
        PREVIEW_GATEWAY_PORT: '4103',
        PREVIEW_SIGNING_SECRET: 'test-preview-signing-secret',
        PREVIEW_HOST_SUFFIXES: 'localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackChild(previewGateway, 'preview-gateway');
    await waitFor('http://127.0.0.1:4103/health');
  }, 60_000);

  afterAll(async () => {
    await probe?.runtime.destroy().catch(() => undefined);
    await Promise.all([terminate(previewGateway), terminate(runner), terminate(gateway)]);
    await Promise.all(agentDataRoots.map((root) => rm(root, { recursive: true, force: true })));
    await platform?.pool.end();
  }, 30_000);

  it('drives remote read/write/edit/bash through a real prompt and records run context', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-agent-runtime-'));
    agentDataRoots.push(dataRoot);
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
    expect(indexed[0]?.status).toBe('ACTIVE');
    const indexedRuns = await platform!.db
      .select()
      .from(agentRun)
      .where(eq(agentRun.id, result.runId));
    expect(indexedRuns[0]?.status).toBe('COMPLETED');
    expect(indexedRuns[0]?.traceId).toBe(result.traceId);
    await runtime.disposeAll();
  }, 120_000);

  it('surfaces FILE_CHANGED and aborts a remote long command through Pi', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-agent-runtime-failure-'));
    agentDataRoots.push(dataRoot);
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
        await api.fs.write({
          path: '/workspace/conflict.txt',
          content: 'original\noutside-change',
        });
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
    const runtimeEvents: string[] = [];
    runtime.subscribe(({ event }) => {
      if (event.type === 'tool_execution_end') runtimeEvents.push(JSON.stringify(event));
    });
    const conflict = await runtime.prompt(session.id, 'Change the conflict file.');
    expect(conflict.status).toBe('COMPLETED');
    expect(runtimeEvents.some((event) => event.includes('FILE_CHANGED'))).toBe(true);
    await expect(api.fs.read({ path: '/workspace/conflict.txt' })).resolves.toMatchObject({
      content: 'original\noutside-change',
    });

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('bash', { command: 'sleep 30' })], {
        stopReason: 'toolUse',
      }),
    ]);
    const longRun = runtime.prompt(session.id, 'Run the long command.');
    setTimeout(() => void runtime.abort(session.id), 500);
    await expect(longRun).resolves.toMatchObject({ status: 'ABORTED' });
    const processProbe = await api.process.exec({
      command: '/bin/bash',
      args: ['-lc', "pgrep -af 'sleep 30' || true"],
      cwd: '/workspace',
      env: {},
      timeoutMs: 5_000,
      maxOutputBytes: 32_768,
      executionId: '00000000-0000-4000-8000-000000000504',
    });
    expect(processProbe.stdout).not.toContain('sleep 30');
    await runtime.disposeAll();
  }, 120_000);

  it('keeps read-only sessions available while the Website mutation lease is held', async () => {
    const leaseRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-agent-runtime-lease-'));
    agentDataRoots.push(leaseRoot);
    await probe!.fs.write({ path: '/workspace/lease-source.txt', content: 'read me' });

    const createRuntime = async (
      providerName: 'cloudcrane-lease-a' | 'cloudcrane-lease-b',
      responses: FauxResponseStep[],
    ) => {
      const faux = fauxProvider({ provider: providerName, models: [{ id: 'deterministic' }] });
      faux.setResponses(responses);
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
        agentDataRoot: path.join(leaseRoot, providerName),
        store: new DrizzleWebsiteAgentStore(platform!),
        modelRuntime,
        model: faux.getModel() as Model<typeof providerName>,
      });
      return { faux, runtime };
    };

    const { runtime: runtimeA } = await createRuntime('cloudcrane-lease-a', [
      fauxAssistantMessage([fauxToolCall('bash', { command: 'sleep 3' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('lease A completed'),
    ]);
    const { faux: fauxB, runtime: runtimeB } = await createRuntime('cloudcrane-lease-b', [
      fauxAssistantMessage([fauxToolCall('read', { path: '/workspace/lease-source.txt' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('read while lease held'),
    ]);
    const sessionA = await runtimeA.createSession();
    const sessionB = await runtimeB.createSession();
    let mutationStarted!: () => void;
    const mutationStartedPromise = new Promise<void>((resolve) => {
      mutationStarted = resolve;
    });
    runtimeA.subscribe(({ event }) => {
      if (event.type === 'tool_execution_start' && event.toolName === 'bash') mutationStarted();
    });
    const runA = runtimeA.prompt(sessionA.id, 'hold the mutation lease');
    await mutationStartedPromise;
    await expect(runtimeB.prompt(sessionB.id, 'read while A mutates')).resolves.toMatchObject({
      status: 'COMPLETED',
    });

    const busyEvents: string[] = [];
    runtimeB.subscribe(({ event }) => {
      if (event.type === 'tool_execution_end') busyEvents.push(JSON.stringify(event));
    });
    fauxB.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('write', { path: '/workspace/lease-b.txt', content: 'blocked' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('mutation was busy'),
    ]);
    await expect(runtimeB.prompt(sessionB.id, 'mutate while A mutates')).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    expect(busyEvents.some((event) => event.includes('WEBSITE_MUTATION_BUSY'))).toBe(true);
    await expect(runA).resolves.toMatchObject({ status: 'COMPLETED' });

    fauxB.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('write', { path: '/workspace/lease-b.txt', content: 'allowed' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('mutation completed'),
    ]);
    await expect(runtimeB.prompt(sessionB.id, 'mutate after A settles')).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    await expect(probe!.fs.read({ path: '/workspace/lease-b.txt' })).resolves.toMatchObject({
      content: 'allowed',
    });
    await Promise.all([runtimeA.disposeAll(), runtimeB.disposeAll()]);
  }, 120_000);

  it('creates a new WebsiteSession without rebinding the source session', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-agent-runtime-session-'));
    agentDataRoots.push(dataRoot);
    const faux = fauxProvider({
      provider: 'cloudcrane-session-identity',
      models: [{ id: 'deterministic' }],
    });
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
      model: faux.getModel() as Model<'cloudcrane-session-identity'>,
    });
    const source = await runtime.createSession();
    const child = await runtime.newSession(source.id);
    expect(child.id).not.toBe(source.id);
    expect(child.piSessionId).not.toBe(source.piSessionId);
    await expect(runtime.openSession(source.id)).resolves.toMatchObject({
      id: source.id,
      piSessionId: source.piSessionId,
      sessionFile: source.sessionFile,
    });
    const rows = await platform!.db
      .select()
      .from(websiteSession)
      .where(eq(websiteSession.websiteId, websiteId));
    expect(rows.some((row) => row.id === source.id && row.piSessionId === source.piSessionId)).toBe(
      true,
    );
    expect(rows.some((row) => row.id === child.id && row.piSessionId === child.piSessionId)).toBe(
      true,
    );
    await runtime.disposeAll();
  }, 120_000);

  it('drives a real WebsiteAgent through the Agent Service browser protocol', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-agent-transport-'));
    agentDataRoots.push(dataRoot);
    const faux = fauxProvider({
      provider: 'cloudcrane-browser-protocol',
      models: [{ id: 'deterministic' }],
    });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('write', { path: '/workspace/index.php', content: '<h1>After</h1>' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxToolCall('preview_refresh', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('preview_navigate', { path: '/about' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('transport run completed after Preview observation'),
    ]);
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const previewClients = new PreviewClientRegistry({ observeMs: 5_000, refreshMs: 5_000 });
    const runtime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: `http://127.0.0.1:${port}`,
      workspaceClientToken: clientToken,
      agentDataRoot: dataRoot,
      store: new DrizzleWebsiteAgentStore(platform!),
      modelRuntime,
      model: faux.getModel() as Model<'cloudcrane-browser-protocol'>,
      previewObservationProvider: new ClientPreviewProvider(previewClients),
    });
    const session = await runtime.createSession();
    await probe!.fs.write({ path: '/workspace/index.php', content: '<h1>Before</h1>' });
    const registry = new WebsiteRuntimeRegistry({
      bindingStore: {
        findWebsiteWorkspace: async () => ({
          websiteId,
          workspaceId,
          websiteStatus: 'active',
          workspaceStatus: 'running',
          previewPort,
        }),
      },
      createRuntime: () => runtime,
    });
    const agentApp = buildAgentServiceApp({
      config: {
        port: 0,
        webOrigin: 'http://localhost:3000',
        workspaceGatewayEndpoint: `http://127.0.0.1:${port}`,
        workspaceGatewayClientToken: clientToken,
        agentDataRoot: dataRoot,
        previewGatewayOriginTemplate: 'http://site-{websiteId}.localhost:4103/',
        previewSigningSecret: 'test-preview-signing-secret',
        previewTokenTtlSeconds: 600,
        modelProvider: 'cloudcrane-browser-protocol',
        modelId: 'deterministic',
        modelAuthPath: undefined,
        modelConfigured: true,
      },
      registry,
      previewClientRegistry: previewClients,
    });
    await agentApp.listen({ host: '127.0.0.1', port: 0 });
    const address = agentApp.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Agent Service did not bind a port');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/v1/agent/connect`);
    const clientB = new WebSocket(`ws://127.0.0.1:${address.port}/v1/agent/connect`);
    const previewClientA = '00000000-0000-4000-8000-000000000511';
    const previewClientB = '00000000-0000-4000-8000-000000000512';
    const previewCapabilities: PreviewCapability[] = [
      'DOM_SNAPSHOT',
      'VISIBLE_TEXT',
      'CONSOLE',
      'WINDOW_ERRORS',
      'VIEWPORT',
      'CURRENT_URL',
    ];
    const observed: PreviewObservation[] = [];
    const previewOperations: string[] = [];
    const clientBRequests: AgentWireMessage[] = [];
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      clientB.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string };
        if (message.type === 'connection.ready') {
          clientB.send(
            JSON.stringify({
              type: 'preview.client.register',
              requestId: 'register-preview-b',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { previewClientId: previewClientB, capabilities: previewCapabilities },
            }),
          );
        }
        if (message.type === 'preview.request') clientBRequests.push(message as AgentWireMessage);
      });
      clientB.on('error', reject);
      client.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as {
          type: string;
          requestId?: string;
          payload?: { runId?: string; commandType?: string; operation?: string; path?: string };
        };
        events.push(message.type);
        if (message.type === 'connection.ready') {
          client.send(
            JSON.stringify({
              type: 'preview.client.register',
              requestId: 'register-preview-a',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { previewClientId: previewClientA, capabilities: previewCapabilities },
            }),
          );
        }
        if (
          message.type === 'command.ack' &&
          message.payload?.commandType === 'preview.client.register'
        ) {
          client.send(
            JSON.stringify({
              type: 'session.attach',
              requestId: 'attach-transport',
              websiteId,
              timestamp: new Date().toISOString(),
              payload: { sessionId: session.id },
            }),
          );
        }
        if (message.type === 'session.snapshot') {
          client.send(
            JSON.stringify({
              type: 'agent.prompt',
              requestId: 'prompt-transport',
              websiteId,
              sessionId: session.id,
              timestamp: new Date().toISOString(),
              payload: { text: 'Create the transport file.' },
            }),
          );
        }
        if (message.type === 'preview.request') {
          const operation = message.payload?.operation ?? '';
          previewOperations.push(operation);
          const path = operation === 'navigate' ? (message.payload?.path ?? '/') : '/';
          const next: PreviewObservation = {
            url: `http://site-${websiteId}.localhost:4103${path}`,
            path,
            title: 'After',
            viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
            scroll: { x: 0, y: 0 },
            dom: [
              {
                ref: 'e1',
                tag: 'h1',
                attributes: { id: 'hero' },
                text: 'After',
                children: [],
              },
            ],
            domTruncated: false,
            visibleText: 'After',
            consoleErrors: [],
            windowErrors: [],
            capturedAt: new Date().toISOString(),
          };
          observed.push(next);
          client.send(
            JSON.stringify({
              type: 'preview.response',
              requestId: message.requestId,
              websiteId,
              sessionId: session.id,
              timestamp: new Date().toISOString(),
              payload: { ok: true, observation: next },
            }),
          );
        }
        if (message.type === 'run.settled' && message.payload?.runId) resolve();
      });
      client.on('error', reject);
    });
    expect(events).toContain('command.ack');
    expect(events).toContain('run.started');
    expect(events).toContain('tool.started');
    expect(events).toContain('tool.completed');
    expect(events).toContain('assistant.completed');
    expect(events).toContain('run.settled');
    expect(previewOperations).toEqual(['refresh', 'navigate']);
    expect(observed.some((item) => item.path === '/about')).toBe(true);
    expect(observed.at(-1)?.visibleText).toContain('After');
    expect(clientBRequests).toHaveLength(0);
    await expect(probe!.fs.read({ path: '/workspace/index.php' })).resolves.toMatchObject({
      content: '<h1>After</h1>',
    });
    const descriptor = agentApp.inject({
      method: 'GET',
      url: `/v1/websites/${websiteId}/preview`,
    });
    const preview = JSON.parse((await descriptor).body) as { url: string };
    const previewUrl = new URL(preview.url);
    const firstPreview = await requestPreview(`/?token=${previewUrl.searchParams.get('token')}`);
    expect(firstPreview.status).toBe(302);
    const previewCookie = firstPreview.headers['set-cookie']?.[0]?.split(';')[0];
    expect(previewCookie).toBeTruthy();
    const finalPreview = await requestPreview('/', previewCookie);
    expect(finalPreview.status).toBe(200);
    expect(finalPreview.body).toContain('<h1>After</h1>');
    expect(finalPreview.body).toContain('/__cloudcrane/preview-bridge.js');
    client.close();
    clientB.close();
    await agentApp.close();
  }, 120_000);
});

function requestPreview(pathname: string, cookie?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: 4103,
          path: pathname,
          headers: {
            host: `site-${websiteId}.localhost:4103`,
            ...(cookie ? { cookie } : {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    },
  );
}
