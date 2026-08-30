import { mkdtemp, readFile } from 'node:fs/promises';
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
});
