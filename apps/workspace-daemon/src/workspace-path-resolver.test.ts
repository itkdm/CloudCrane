import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceDaemonError } from './errors.js';
import { WorkspacePathResolver } from './workspace-path-resolver.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-workspace-'));
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await writeFile(path.join(root, 'nested', 'file.txt'), 'ok');
  return { root, resolver: new WorkspacePathResolver(root) };
}

describe('WorkspacePathResolver', () => {
  it('resolves a normal workspace path', async () => {
    const { root, resolver } = await fixture();
    expect(await resolver.resolve('/workspace/nested/file.txt')).toBe(
      path.join(root, 'nested', 'file.txt'),
    );
  });

  it.each(['/workspace/../outside', '/etc/passwd', '/proc/1/status', '/sys/kernel'])(
    'rejects out-of-scope path %s',
    async (input) => {
      const { resolver } = await fixture();
      await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'PATH_OUT_OF_SCOPE' });
    },
  );

  it('rejects a symlink to an external file', async () => {
    const { root, resolver } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-outside-'));
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    try {
      await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    } catch {
      return;
    }
    await expect(resolver.resolve('/workspace/link.txt')).rejects.toMatchObject({
      code: 'PATH_OUT_OF_SCOPE',
    });
  });

  it('rejects a new file whose parent symlink escapes', async () => {
    const { root, resolver } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-outside-'));
    try {
      await symlink(outside, path.join(root, 'linked-parent'));
    } catch {
      return;
    }
    await expect(resolver.resolve('/workspace/linked-parent/new.txt')).rejects.toBeInstanceOf(
      WorkspaceDaemonError,
    );
    await expect(resolver.resolve('/workspace/linked-parent/new.txt')).rejects.toMatchObject({
      code: 'PATH_OUT_OF_SCOPE',
    });
  });
});
