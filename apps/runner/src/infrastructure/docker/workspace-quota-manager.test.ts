import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceQuotaManager } from './workspace-quota-manager.js';

describe('WorkspaceQuotaManager', () => {
  it('assigns a stable private project ID and installs a hard block and inode limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-workspace-quota-'));
    const workspaceId = '00000001-0000-4000-8000-000000000001';
    const persistentPath = path.join(root, workspaceId, 'workspace');
    await mkdir(persistentPath, { recursive: true });
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const manager = new WorkspaceQuotaManager(root, 128 * 1024 * 1024, run);
    try {
      await manager.ensure(workspaceId, persistentPath);
      const projectId = (
        await readFile(path.join(root, workspaceId, '.workspace-project-id'), 'utf8')
      ).trim();
      expect(projectId).toMatch(/^[1-9]\d*$/);
      if (process.platform !== 'win32')
        expect(
          (await stat(path.join(root, workspaceId, '.workspace-project-id'))).mode & 0o777,
        ).toBe(0o400);
      expect(run).toHaveBeenNthCalledWith(1, 'find', [
        persistentPath,
        '-xdev',
        '!',
        '-type',
        'l',
        '-exec',
        'chattr',
        '-p',
        projectId,
        '{}',
        '+',
      ]);
      expect(run).toHaveBeenNthCalledWith(2, 'find', [
        persistentPath,
        '-xdev',
        '-type',
        'd',
        '-exec',
        'chattr',
        '+P',
        '{}',
        '+',
      ]);
      expect(run).toHaveBeenNthCalledWith(3, 'setquota', [
        '-P',
        projectId,
        '0',
        '131072',
        '0',
        '100000',
        root,
      ]);
      run.mockClear();
      await manager.ensure(workspaceId, persistentPath);
      expect(run).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledWith('setquota', [
        '-P',
        projectId,
        '0',
        '131072',
        '0',
        '100000',
        root,
      ]);
      run.mockClear();
      await manager.release(Number(projectId));
      expect(run).toHaveBeenCalledWith('setquota', ['-P', projectId, '0', '0', '0', '0', root]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed if host quota tooling cannot install the hard limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-workspace-quota-fail-'));
    const workspaceId = '00000002-0000-4000-8000-000000000002';
    const persistentPath = path.join(root, workspaceId, 'workspace');
    const run = vi.fn(async (command: string) => {
      if (command === 'setquota') throw new Error('project quotas are not enabled');
      return { stdout: '', stderr: '' };
    });
    const manager = new WorkspaceQuotaManager(root, 128 * 1024 * 1024, run);
    try {
      await mkdir(persistentPath, { recursive: true });
      await expect(manager.ensure(workspaceId, persistentPath)).rejects.toThrow(
        'project quotas are not enabled',
      );
      await expect(
        readFile(path.join(root, workspaceId, '.workspace-project-id')),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
