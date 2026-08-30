import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceClientError } from '@cloudcrane/workspace-client';
import { RemotePathMapper, SafeEnvFilter, createCloudCraneCodingTools } from './index.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe('RemotePathMapper', () => {
  it('normalizes only POSIX paths within /workspace', () => {
    const mapper = new RemotePathMapper();
    expect(mapper.map('src/index.ts')).toBe('/workspace/src/index.ts');
    expect(mapper.map('/workspace/src/../index.ts')).toBe('/workspace/index.ts');
    expect(() => mapper.map('/etc/passwd')).toThrowError(WorkspaceClientError);
    expect(() => mapper.map('/workspace/../../etc/passwd')).toThrowError(WorkspaceClientError);
    expect(() => mapper.map(String.raw`C:\workspace\index.ts`)).toThrowError(WorkspaceClientError);
  });
});

describe('SafeEnvFilter', () => {
  it('passes only explicit non-secret environment metadata', () => {
    expect(
      new SafeEnvFilter().filter({
        PATH: '/usr/bin',
        LANG: 'C.UTF-8',
        LC_ALL: 'C',
        DATABASE_URL: 'postgres://secret',
        OPENAI_API_KEY: 'secret',
      }),
    ).toEqual({ PATH: '/usr/bin', LANG: 'C.UTF-8', LC_ALL: 'C' });
  });
});

describe('CloudCrane Pi ToolDefinitions', () => {
  it('executes Pi write and edit algorithms against remote operations', async () => {
    let content = 'hello cloudcrane';
    const calls: Array<{ path: string; expectedSha256?: string }> = [];
    const client = {
      fs: {
        stat: vi.fn(async () => ({
          path: '/workspace/index.php',
          type: 'file' as const,
          size: content.length,
          mode: 0o644,
          modifiedAt: new Date().toISOString(),
        })),
        read: vi.fn(async () => ({
          content,
          sha256: sha(content),
          size: content.length,
          truncated: false,
        })),
        write: vi.fn(
          async (request: { path: string; content: string; expectedSha256?: string }) => {
            calls.push(request);
            if (request.expectedSha256 && request.expectedSha256 !== sha(content))
              throw new WorkspaceClientError('FILE_CHANGED', 'changed');
            content = request.content;
            return { sha256: sha(content), size: content.length };
          },
        ),
        mkdir: vi.fn(async () => ({ path: '/workspace' })),
        list: vi.fn(async () => ({ path: '/workspace', entries: [] })),
      },
      process: {
        exec: vi.fn(),
        cancel: vi.fn(),
      },
    } as never;
    const tools = createCloudCraneCodingTools({ workspaceClient: client });
    expect(Object.keys(tools)).toEqual(['read', 'edit', 'write', 'bash', 'ls', 'find']);

    await tools.write.execute(
      'write-1',
      { path: 'index.php', content: 'hello cloudcrane' },
      undefined,
      undefined,
      undefined as never,
    );
    await tools.edit.execute(
      'edit-1',
      { path: 'index.php', edits: [{ oldText: 'cloudcrane', newText: 'CloudCrane' }] },
      undefined,
      undefined,
      undefined as never,
    );
    expect(content).toBe('hello CloudCrane');
    expect(calls.at(-1)?.expectedSha256).toBe(sha('hello cloudcrane'));
  });
});
