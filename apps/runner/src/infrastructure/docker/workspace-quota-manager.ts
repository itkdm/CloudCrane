import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const projectMarker = '.workspace-project-id';
type CommandRunner = (command: string, args: string[]) => Promise<unknown>;

export class WorkspaceQuotaManager {
  private provisioning: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspaceRoot: string,
    private readonly limitBytes: number,
    private readonly run: CommandRunner = async (command, args) => {
      await execFile(command, args);
    },
  ) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 64 * 1024 * 1024)
      throw new Error('WORKSPACE_DISK_LIMIT_BYTES must be an integer of at least 64 MiB');
  }

  async ensure(workspaceId: string, persistentPath: string): Promise<void> {
    await this.withProvisioningLock(async () => {
      await mkdir(path.join(persistentPath, '.cloudcrane'), { recursive: true });
      const existingId = await this.readProjectId(persistentPath);
      const id = existingId ?? (await this.allocateProjectId(workspaceId, persistentPath));
      if (existingId === undefined) {
        await this.run('find', [
          persistentPath,
          '-xdev',
          '!',
          '-type',
          'l',
          '-exec',
          'chattr',
          '-p',
          String(id),
          '{}',
          '+',
        ]);
        await this.run('find', [
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
      }
      await this.applyLimit(id);
      if (existingId === undefined) await this.writeProjectId(persistentPath, id);
    });
  }

  private async applyLimit(id: number): Promise<void> {
    const blocksKb = Math.ceil(this.limitBytes / 1024);
    const inodeLimit = Math.max(100_000, Math.ceil(this.limitBytes / (16 * 1024)));
    await this.run('setquota', [
      '-P',
      String(id),
      '0',
      String(blocksKb),
      '0',
      String(inodeLimit),
      this.workspaceRoot,
    ]);
  }

  async release(projectId: number | undefined): Promise<void> {
    const id = projectId;
    if (id === undefined) return;
    await this.run('setquota', ['-P', String(id), '0', '0', '0', '0', this.workspaceRoot]);
  }

  private async allocateProjectId(workspaceId: string, persistentPath: string): Promise<number> {
    const occupied = new Set<number>();
    for (const entry of await readdir(this.workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === path.basename(path.dirname(persistentPath)))
        continue;
      const otherMarker = path.join(this.workspaceRoot, entry.name, projectMarker);
      try {
        const raw = (await readFile(otherMarker, 'utf8')).trim();
        if (/^[1-9]\d{0,9}$/.test(raw)) occupied.add(Number(raw));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }

    const hash = workspaceId.replaceAll('-', '').slice(0, 8);
    let id = Number.parseInt(hash, 16) & 0x7fffffff;
    if (id === 0) id = 1;
    while (occupied.has(id)) id = id === 0x7fffffff ? 1 : id + 1;

    return id;
  }

  private async writeProjectId(persistentPath: string, id: number): Promise<void> {
    const marker = path.join(path.dirname(persistentPath), projectMarker);
    const temporary = `${marker}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${id}\n`, { flag: 'wx', mode: 0o400 });
    await rename(temporary, marker);
  }

  private async readProjectId(persistentPath: string): Promise<number | undefined> {
    const marker = path.join(path.dirname(persistentPath), projectMarker);
    try {
      const info = await lstat(marker);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('Workspace project quota marker is not a regular file');
      const raw = (await readFile(marker, 'utf8')).trim();
      if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 0x7fffffff)
        throw new Error('Workspace project quota marker is invalid');
      return Number(raw);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async withProvisioningLock<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.provisioning;
    let release!: () => void;
    this.provisioning = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
