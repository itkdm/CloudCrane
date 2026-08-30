import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Model,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { WorkspaceClientContext } from '@cloudcrane/workspace-client';
import {
  createInMemoryWebsiteAgentStore,
  WebsiteAgentRuntime,
  type WorkspaceClientFactory,
} from './runtime.js';

const websiteId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';

describe('WebsiteAgentRuntime', () => {
  it('runs a real Pi prompt with remote tools, persists JSONL, and reopens history', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-agent-'));
    const faux = fauxProvider({ provider: 'cloudcrane-test', models: [{ id: 'deterministic' }] });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('read', { path: 'index.php' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('remote read completed'),
    ]);
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const contexts: Array<{ traceId?: string; agentRunId?: string }> = [];
    const client = {
      fs: {
        read: vi.fn(async ({ path: remotePath }: { path: string }) => {
          contexts.push(contextProvider());
          if (remotePath.endsWith('AGENTS.md'))
            return {
              content: 'Remote workspace instructions',
              sha256: 'a'.repeat(64),
              size: 29,
              truncated: false,
            };
          return {
            content: '<?php echo "ok";',
            sha256: 'b'.repeat(64),
            size: 15,
            truncated: false,
          };
        }),
        stat: vi.fn(async () => ({
          path: '/workspace/index.php',
          type: 'file' as const,
          size: 15,
          mode: 0o644,
          modifiedAt: new Date().toISOString(),
        })),
        write: vi.fn(),
        list: vi.fn(async () => ({ path: '/workspace', entries: [] })),
        mkdir: vi.fn(),
      },
      process: { exec: vi.fn(), cancel: vi.fn() },
    };
    let contextProvider: () => WorkspaceClientContext = () => ({ websiteId, workspaceId });
    const factory: WorkspaceClientFactory = (provider) => {
      contextProvider = provider;
      return client as never;
    };
    const store = createInMemoryWebsiteAgentStore();
    const runtime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: 'http://gateway.invalid',
      workspaceClientToken: 'client-only',
      agentDataRoot: dataRoot,
      store,
      modelRuntime,
      model: faux.getModel() as Model<'cloudcrane-test'>,
      workspaceClientFactory: factory,
    });
    const session = await runtime.createSession();
    const events: string[] = [];
    runtime.subscribe(({ event }) => events.push(event.type));

    const result = await runtime.prompt(session.id, 'Read index.php');

    expect(result.status).toBe('COMPLETED');
    expect(result.finalText).toBe('remote read completed');
    expect(events).toContain('agent_settled');
    expect(
      contexts.some(
        (context) => context.traceId === result.traceId && context.agentRunId === result.runId,
      ),
    ).toBe(true);
    const sessionPath = path.join(dataRoot, session.sessionFile.split('/').join(path.sep));
    const jsonl = await readFile(sessionPath, 'utf8');
    expect(jsonl).toContain('remote read completed');

    await runtime.closeSession(session.id);
    expect(runtime.activeSessionCount).toBe(0);
    await runtime.openSession(session.id);
    expect(runtime.activeSessionCount).toBe(1);
    await runtime.disposeAll();
  });

  it('keeps WebsiteSession and Pi Session identities stable across new/select/reopen', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-session-identity-'));
    const store = createInMemoryWebsiteAgentStore();
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const runtime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: 'http://gateway.invalid',
      workspaceClientToken: 'client-only',
      agentDataRoot: dataRoot,
      store,
      modelRuntime,
      workspaceClientFactory: () =>
        ({
          fs: {
            read: vi.fn(async () => ({
              content: '',
              sha256: 'a'.repeat(64),
              size: 0,
              truncated: false,
            })),
          },
        }) as never,
    });

    const first = await runtime.createSession();
    const second = await runtime.newSession(first.id);
    expect(second.id).not.toBe(first.id);
    expect(second.piSessionId).not.toBe(first.piSessionId);
    expect(await runtime.openSession(first.id)).toMatchObject({
      id: first.id,
      piSessionId: first.piSessionId,
      sessionFile: first.sessionFile,
      status: 'NEW',
    });
    await expect(runtime.switchSession(first.id, second.id)).resolves.toMatchObject({
      id: second.id,
      piSessionId: second.piSessionId,
    });
    await runtime.disposeAll();

    const reopenedRuntime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: 'http://gateway.invalid',
      workspaceClientToken: 'client-only',
      agentDataRoot: dataRoot,
      store,
      modelRuntime,
      workspaceClientFactory: () =>
        ({
          fs: {
            read: vi.fn(async () => ({
              content: '',
              sha256: 'b'.repeat(64),
              size: 0,
              truncated: false,
            })),
          },
        }) as never,
    });
    const reopened = await reopenedRuntime.openSession(first.id);
    expect(reopened.piSessionId).toBe(first.piSessionId);
    expect(reopened.id).toBe(first.id);
    await reopenedRuntime.disposeAll();
  });

  it('refreshes remote AGENTS.md and replaces the model-facing cwd', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-resources-'));
    const faux = fauxProvider({
      provider: 'cloudcrane-resources',
      models: [{ id: 'deterministic' }],
    });
    faux.setResponses([fauxAssistantMessage('first'), fauxAssistantMessage('second')]);
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    let instructions = 'A';
    const systemPrompts: string[] = [];
    const client = {
      fs: {
        read: vi.fn(async ({ path: remotePath }: { path: string }) => ({
          content: remotePath.endsWith('AGENTS.md') ? instructions : 'file',
          sha256: 'c'.repeat(64),
          size: 4,
          truncated: false,
        })),
      },
    };
    const store = createInMemoryWebsiteAgentStore();
    const runtime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: 'http://gateway.invalid',
      workspaceClientToken: 'client-only',
      agentDataRoot: dataRoot,
      store,
      modelRuntime,
      model: faux.getModel() as Model<'cloudcrane-resources'>,
      workspaceClientFactory: () => client as never,
    });
    const first = await runtime.createSession();
    await runtime.prompt(first.id, 'hello');
    systemPrompts.push(await runtime.getSystemPrompt(first.id));
    expect(systemPrompts.at(-1)).toContain('Current working directory: /workspace');
    expect(systemPrompts.at(-1)).not.toContain(dataRoot);
    expect(systemPrompts.at(-1)).not.toContain('runtime-cwd');

    instructions = 'B';
    const second = await runtime.createSession();
    expect(second.id).not.toBe(first.id);
    await runtime.prompt(second.id, 'hello again');
    systemPrompts.push(await runtime.getSystemPrompt(second.id));
    expect(systemPrompts.at(-1)).toContain('B');
    expect(client.fs.read).toHaveBeenCalledTimes(2);
    await runtime.disposeAll();
  });

  it('reopens a NEW session without changing its Pi session id before first persistence', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-new-session-'));
    const store = createInMemoryWebsiteAgentStore();
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const client = {
      fs: {
        read: vi.fn(async () => ({
          content: '',
          sha256: 'd'.repeat(64),
          size: 0,
          truncated: false,
        })),
      },
    };
    const makeRuntime = () =>
      new WebsiteAgentRuntime({
        websiteId,
        workspaceId,
        workspaceGatewayEndpoint: 'http://gateway.invalid',
        workspaceClientToken: 'client-only',
        agentDataRoot: dataRoot,
        store,
        modelRuntime,
        workspaceClientFactory: () => client as never,
      });
    const runtime = makeRuntime();
    const created = await runtime.createSession();
    const originalPiId = created.piSessionId;
    await runtime.disposeAll();

    const reopenedRuntime = makeRuntime();
    const reopened = await reopenedRuntime.openSession(created.id);
    expect(reopened.piSessionId).toBe(originalPiId);
    expect(reopened.status).toBe('NEW');
    await reopenedRuntime.disposeAll();
    await expect(access(path.join(dataRoot, created.sessionFile))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects a concurrent primary prompt before creating a second AgentRun', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-session-busy-'));
    const faux = fauxProvider({
      provider: 'cloudcrane-session-busy',
      models: [{ id: 'deterministic' }],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processExec = vi.fn(async () => {
      await gate;
      return { status: 'completed', exitCode: 0, stdout: '', stderr: '', truncated: false };
    });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('bash', { command: 'hold' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('first completed'),
    ]);
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const store = createInMemoryWebsiteAgentStore();
    const createRun = vi.spyOn(store, 'createRun');
    const runtime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: 'http://gateway.invalid',
      workspaceClientToken: 'client-only',
      agentDataRoot: dataRoot,
      store,
      modelRuntime,
      model: faux.getModel() as Model<'cloudcrane-session-busy'>,
      workspaceClientFactory: () =>
        ({
          fs: {
            read: vi.fn(async () => ({
              content: '',
              sha256: 'e'.repeat(64),
              size: 0,
              truncated: false,
            })),
          },
          process: { exec: processExec, cancel: vi.fn() },
        }) as never,
    });
    const session = await runtime.createSession();
    const firstRun = runtime.prompt(session.id, 'first');
    for (let attempt = 0; attempt < 40 && processExec.mock.calls.length === 0; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(runtime.prompt(session.id, 'second')).rejects.toMatchObject({
      code: 'SESSION_BUSY',
    });
    expect(createRun).toHaveBeenCalledTimes(1);
    release();
    await expect(firstRun).resolves.toMatchObject({ status: 'COMPLETED' });
    await runtime.disposeAll();
  });

  it('allows read-only work across sessions while serializing mutation tools per Website', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-mutation-lease-'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processExec = vi.fn(async () => {
      await gate;
      return { status: 'completed', exitCode: 0, stdout: '', stderr: '', truncated: false };
    });
    const client = {
      fs: {
        read: vi.fn(async () => ({
          content: '',
          sha256: 'f'.repeat(64),
          size: 0,
          truncated: false,
        })),
      },
      process: { exec: processExec, cancel: vi.fn() },
    };
    const createRuntime = async (providerName: 'lease-a' | 'lease-b', response: string) => {
      const faux = fauxProvider({ provider: providerName, models: [{ id: 'deterministic' }] });
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('bash', { command: 'hold' })], {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage(response),
      ]);
      const modelRuntime = await ModelRuntime.create({
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      modelRuntime.registerNativeProvider(faux.provider);
      return new WebsiteAgentRuntime({
        websiteId,
        workspaceId,
        workspaceGatewayEndpoint: 'http://gateway.invalid',
        workspaceClientToken: 'client-only',
        agentDataRoot: path.join(dataRoot, providerName),
        store: createInMemoryWebsiteAgentStore(),
        modelRuntime,
        model: faux.getModel() as Model<typeof providerName>,
        workspaceClientFactory: () => client as never,
      });
    };
    const runtimeA = await createRuntime('lease-a', 'A completed');
    const runtimeB = await createRuntime('lease-b', 'B handled busy');
    const sessionA = await runtimeA.createSession();
    const sessionB = await runtimeB.createSession();
    const runA = runtimeA.prompt(sessionA.id, 'mutate A');
    for (let attempt = 0; attempt < 40 && processExec.mock.calls.length === 0; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const busyEvents: string[] = [];
    runtimeB.subscribe(({ event }) => {
      if (event.type === 'tool_execution_end') busyEvents.push(JSON.stringify(event));
    });
    await expect(runtimeB.prompt(sessionB.id, 'mutate B')).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    expect(processExec).toHaveBeenCalledTimes(1);
    expect(busyEvents.some((event) => event.includes('WEBSITE_MUTATION_BUSY'))).toBe(true);
    release();
    await expect(runA).resolves.toMatchObject({ status: 'COMPLETED' });
    await Promise.all([runtimeA.disposeAll(), runtimeB.disposeAll()]);
  });
});
