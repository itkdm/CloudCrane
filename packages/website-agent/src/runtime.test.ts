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
  projectMessages,
  WebsiteAgentRuntime,
  type WorkspaceClientFactory,
  type WebsiteAgentLifecycleEvent,
} from './runtime.js';

const websiteId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';

describe('WebsiteAgentRuntime', () => {
  it('rebuilds user, assistant, and paired tool messages from Pi AgentMessage history', () => {
    const messages = projectMessages([
      { role: 'user', content: 'Read index.php', timestamp: 1 },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'private reasoning' },
          { type: 'text', text: 'I will read it.' },
          { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'index.php' } },
        ],
        timestamp: 2,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read',
        content: [{ type: 'text', text: 'file contents' }],
        isError: false,
        timestamp: 3,
      },
      { role: 'user', content: [{ type: 'text', text: 'Now summarize it.' }], timestamp: 4 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Summary' }],
        timestamp: 5,
      },
    ]);

    expect(messages).toMatchObject([
      { role: 'user', text: 'Read index.php', turnId: 'turn-0', kind: 'message' },
      { role: 'assistant', text: 'I will read it.', turnId: 'turn-0' },
      {
        role: 'tool',
        toolCallId: 'call-1',
        toolName: 'read',
        input: '{"path":"index.php"}',
        output: 'file contents',
        text: 'file contents',
        isError: false,
        status: 'completed',
        turnId: 'turn-0',
      },
      { role: 'user', text: 'Now summarize it.', turnId: 'turn-1' },
      { role: 'assistant', text: 'Summary', turnId: 'turn-1' },
    ]);
    expect(messages.some((message) => message.text.includes('private reasoning'))).toBe(false);
  });

  it('redacts and bounds tool snapshot data while retaining error pairing', () => {
    const messages = projectMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-error',
            name: 'bash',
            arguments: { command: 'echo password=top-secret' },
          },
        ],
        timestamp: 1,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-error',
        toolName: 'bash',
        content: [{ type: 'text', text: 'secret=top-secret' }],
        isError: true,
        timestamp: 2,
      },
    ]);
    expect(messages).toMatchObject([
      {
        toolCallId: 'call-error',
        input: '{"command":"echo password=[redacted]"}',
        output: 'secret=[redacted]',
        isError: true,
        status: 'error',
      },
    ]);
    expect(JSON.stringify(messages)).not.toContain('top-secret');
  });

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
    const lifecycleEvents: WebsiteAgentLifecycleEvent[] = [];
    runtime.subscribe(({ event }) => {
      events.push(event.type);
      if (event.type === 'run_settled' || event.type === 'run_started') lifecycleEvents.push(event);
    });

    const result = await runtime.prompt(session.id, 'Read index.php');

    expect(result.status).toBe('COMPLETED');
    expect(result.finalText).toBe('remote read completed');
    await expect(store.findSession(websiteId, session.id)).resolves.toMatchObject({
      title: 'Read index.php',
    });
    expect(events).toContain('agent_settled');
    expect(lifecycleEvents.at(-1)).toMatchObject({
      type: 'run_settled',
      finalMessageId: expect.any(String),
    });
    expect(
      contexts.some(
        (context) => context.traceId === result.traceId && context.agentRunId === result.runId,
      ),
    ).toBe(true);
    const sessionPath = path.join(dataRoot, session.sessionFile.split('/').join(path.sep));
    const jsonl = await readFile(sessionPath, 'utf8');
    expect(jsonl).toContain('remote read completed');
    expect(jsonl).toContain('"type":"session_info"');

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
            list: vi.fn(async ({ path }: { path: string }) => ({ path, entries: [] })),
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
            list: vi.fn(async ({ path }: { path: string }) => ({ path, entries: [] })),
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
        list: vi.fn(async ({ path }: { path: string }) => ({ path, entries: [] })),
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
    expect(client.fs.read).toHaveBeenCalledTimes(4);
    await runtime.disposeAll();
  });

  it('loads website skills through Pi and refreshes their metadata without restarting the session', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-skills-'));
    const faux = fauxProvider({ provider: 'cloudcrane-skills', models: [{ id: 'deterministic' }] });
    faux.setResponses([fauxAssistantMessage('first'), fauxAssistantMessage('second')]);
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    let description = 'Use dark green buttons and verify Preview.';
    const client = {
      fs: {
        read: vi.fn(async ({ path: remotePath }: { path: string }) => ({
          content: remotePath.endsWith('AGENTS.md')
            ? ''
            : `---\nname: frontend-design\ndescription: ${description}\n---\n# Frontend Design\n`,
          sha256: '1'.repeat(64),
          size: 128,
          truncated: false,
        })),
        list: vi.fn(async ({ path: remotePath }: { path: string }) => ({
          path: remotePath,
          entries:
            remotePath === '/workspace/.agents/skills'
              ? [
                  {
                    path: '/workspace/.agents/skills/frontend-design',
                    type: 'directory' as const,
                    size: 0,
                    mode: 0o755,
                    modifiedAt: new Date().toISOString(),
                  },
                ]
              : remotePath === '/workspace/.agents/skills/frontend-design'
                ? [
                    {
                      path: '/workspace/.agents/skills/frontend-design/SKILL.md',
                      type: 'file' as const,
                      size: 128,
                      mode: 0o644,
                      modifiedAt: new Date().toISOString(),
                    },
                  ]
                : [],
        })),
      },
    };
    const runtime = new WebsiteAgentRuntime({
      websiteId,
      workspaceId,
      workspaceGatewayEndpoint: 'http://gateway.invalid',
      workspaceClientToken: 'client-only',
      agentDataRoot: dataRoot,
      store: createInMemoryWebsiteAgentStore(),
      modelRuntime,
      model: faux.getModel() as Model<'cloudcrane-skills'>,
      workspaceClientFactory: () => client as never,
    });

    const session = await runtime.createSession();
    await runtime.prompt(session.id, 'design the page');
    const firstPrompt = await runtime.getSystemPrompt(session.id);
    expect(firstPrompt).toContain('Use dark green buttons and verify Preview.');
    expect(firstPrompt).toContain('/workspace/.agents/skills/frontend-design/SKILL.md');

    description = 'Use dark blue buttons and verify Preview.';
    await runtime.prompt(session.id, 'design the page again');
    const secondPrompt = await runtime.getSystemPrompt(session.id);
    expect(secondPrompt).toContain('Use dark blue buttons and verify Preview.');
    expect(secondPrompt).not.toContain('Use dark green buttons and verify Preview.');
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
        list: vi.fn(async ({ path }: { path: string }) => ({ path, entries: [] })),
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
            list: vi.fn(async ({ path }: { path: string }) => ({ path, entries: [] })),
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
        list: vi.fn(async ({ path }: { path: string }) => ({ path, entries: [] })),
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
