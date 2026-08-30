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

  it('invalidates the edit SHA after FILE_CHANGED and rereads before retrying', async () => {
    let content = 'before';
    let changed = false;
    const writes: Array<{ expectedSha256?: string }> = [];
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
        write: vi.fn(async (request: { expectedSha256?: string; content: string }) => {
          writes.push(request);
          if (!changed) {
            changed = true;
            throw new WorkspaceClientError('FILE_CHANGED', 'changed');
          }
          content = request.content;
          return { sha256: sha(content), size: content.length };
        }),
        mkdir: vi.fn(async () => ({ path: '/workspace' })),
        list: vi.fn(async () => ({ path: '/workspace', entries: [] })),
      },
      process: { exec: vi.fn(), cancel: vi.fn() },
    };
    const tools = createCloudCraneCodingTools({ workspaceClient: client as never });
    await expect(
      tools.edit.execute(
        'edit-1',
        { path: 'index.php', edits: [{ oldText: 'before', newText: 'first' }] },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    await tools.edit.execute(
      'edit-2',
      { path: 'index.php', edits: [{ oldText: 'before', newText: 'second' }] },
      undefined,
      undefined,
      undefined as never,
    );
    expect(writes.map((write) => write.expectedSha256)).toEqual([sha('before'), sha('before')]);
    expect(content).toBe('second');
  });

  it('does not cache the SHA of a truncated read', async () => {
    const write = vi.fn(async () => ({ sha256: sha('new'), size: 3 }));
    const client = {
      fs: {
        stat: vi.fn(async () => ({
          path: '/workspace/index.php',
          type: 'file' as const,
          size: 100,
          mode: 0o644,
          modifiedAt: new Date().toISOString(),
        })),
        read: vi.fn(async () => ({
          content: 'cut',
          sha256: sha('full'),
          size: 100,
          truncated: true,
        })),
        write,
        mkdir: vi.fn(async () => ({ path: '/workspace' })),
        list: vi.fn(async () => ({ path: '/workspace', entries: [] })),
      },
      process: { exec: vi.fn(), cancel: vi.fn() },
    };
    const tools = createCloudCraneCodingTools({ workspaceClient: client as never });
    await expect(
      tools.edit.execute(
        'edit-1',
        { path: 'index.php', edits: [{ oldText: 'cut', newText: 'new' }] },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({ code: 'OUTPUT_TRUNCATED' });
    expect(write).not.toHaveBeenCalled();
  });
});
