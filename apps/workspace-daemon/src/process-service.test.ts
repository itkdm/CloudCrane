import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProcessService } from './process-service.js';
import { WorkspacePathResolver } from './workspace-path-resolver.js';

const node = process.execPath;
const script = 'setTimeout(() => process.stdout.write("done"), 1000)';

describe('ProcessService', () => {
  it('enforces timeout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-process-'));
    const service = new ProcessService(new WorkspacePathResolver(root));
    await expect(
      service.exec({
        command: node,
        args: ['-e', script],
        cwd: '/workspace',
        env: {},
        timeoutMs: 20,
        maxOutputBytes: 1000,
        executionId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
  });

  it('cancels an active execution', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcrane-process-'));
    const service = new ProcessService(new WorkspacePathResolver(root));
    const executionId = randomUUID();
    const pending = service.exec({
      command: node,
      args: ['-e', script],
      cwd: '/workspace',
      env: {},
      timeoutMs: 10_000,
      maxOutputBytes: 1000,
      executionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(service.cancel(executionId).cancelled).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
  });
});
