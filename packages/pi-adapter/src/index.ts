import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type BashOperations,
  type EditOperations,
  type FindOperations,
  type LsOperations,
  type ReadOperations,
  type WriteOperations,
} from '@earendil-works/pi-coding-agent';
import { WorkspaceClient, WorkspaceClientError } from '@cloudcrane/workspace-client';

const REMOTE_ROOT = '/workspace';
const DEFAULT_PROCESS_OUTPUT_BYTES = 10_485_760;
const DEFAULT_BASH_TIMEOUT_MS = 120_000;

export class RemotePathMapper {
  constructor(private readonly root = REMOTE_ROOT) {
    if (root !== REMOTE_ROOT) throw new Error(`Remote root must be ${REMOTE_ROOT}`);
  }

  map(input: string): string {
    if (!input || input.includes('\0') || input.includes('\\') || /^[A-Za-z]:/.test(input))
      throw new WorkspaceClientError(
        'PATH_OUT_OF_SCOPE',
        'path must use POSIX syntax inside /workspace',
      );
    const candidate = path.posix.resolve(
      input.startsWith('/') ? input : path.posix.join(this.root, input),
    );
    if (candidate !== this.root && !candidate.startsWith(`${this.root}/`))
      throw new WorkspaceClientError('PATH_OUT_OF_SCOPE', 'path escapes /workspace');
    return candidate;
  }
}

export class SafeEnvFilter {
  private readonly allowed = new Set([
    'HOME',
    'LANG',
    'PATH',
    'PI_MODEL',
    'PI_REASONING_LEVEL',
    'PI_SESSION_ID',
  ]);

  filter(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env ?? {})) {
      if ((this.allowed.has(key) || key.startsWith('LC_')) && value !== undefined)
        result[key] = value;
    }
    return result;
  }
}

class RemoteToolOperations {
  readonly mapper = new RemotePathMapper();
  readonly safeEnv = new SafeEnvFilter();
  private readonly shaByPath = new Map<string, string>();

  constructor(readonly workspaceClient: WorkspaceClient) {}

  readonly read: ReadOperations = {
    access: (absolutePath) => this.access(absolutePath),
    readFile: (absolutePath) => this.readFile(absolutePath),
  };

  readonly edit: EditOperations = {
    access: (absolutePath) => this.access(absolutePath),
    readFile: (absolutePath) => this.readFile(absolutePath, false),
    writeFile: (absolutePath, content) => this.writeFile(absolutePath, content, true),
  };

  readonly write: WriteOperations = {
    mkdir: (directory) => this.mkdir(directory),
    writeFile: (absolutePath, content) => this.writeFile(absolutePath, content, false),
  };

  readonly ls: LsOperations = {
    exists: (absolutePath) => this.exists(absolutePath),
    stat: (absolutePath) => this.stat(absolutePath),
    readdir: (absolutePath) => this.readdir(absolutePath),
  };

  readonly find: FindOperations = {
    exists: (absolutePath) => this.exists(absolutePath),
    glob: (pattern, cwd, options) => this.glob(pattern, cwd, options.ignore, options.limit),
  };

  readonly bash: BashOperations = {
    exec: (command, cwd, options) => this.exec(command, cwd, options),
  };

  private async access(absolutePath: string) {
    await this.workspaceClient.fs.stat({ path: this.map(absolutePath) });
  }

  private async exists(absolutePath: string) {
    try {
      await this.access(absolutePath);
      return true;
    } catch (error) {
      if (error instanceof WorkspaceClientError && error.code === 'FILE_NOT_FOUND') return false;
      throw error;
    }
  }

  private async stat(absolutePath: string) {
    const result = await this.workspaceClient.fs.stat({ path: this.map(absolutePath) });
    return { isDirectory: () => result.type === 'directory' };
  }

  private async readdir(absolutePath: string) {
    const result = await this.workspaceClient.fs.list({ path: this.map(absolutePath) });
    return result.entries.map((entry) => path.posix.basename(entry.path));
  }

  private async readFile(absolutePath: string, rememberSha = true): Promise<Buffer> {
    const remotePath = this.map(absolutePath);
    const result = await this.workspaceClient.fs.read({ path: remotePath });
    if (result.truncated) {
      this.shaByPath.delete(remotePath);
      throw new WorkspaceClientError(
        'OUTPUT_TRUNCATED',
        'remote file was truncated; read the file in smaller sections before editing',
        { path: remotePath, size: result.size },
      );
    }
    if (rememberSha || !this.shaByPath.has(remotePath))
      this.shaByPath.set(remotePath, result.sha256);
    return Buffer.from(result.content, 'utf8');
  }

  private async mkdir(directory: string) {
    await this.workspaceClient.fs.mkdir({ path: this.map(directory), recursive: true });
  }

  private async writeFile(absolutePath: string, content: string, checkSha: boolean) {
    const remotePath = this.map(absolutePath);
    const expectedSha256 = checkSha ? this.shaByPath.get(remotePath) : undefined;
    let result;
    try {
      result = await this.workspaceClient.fs.write({
        path: remotePath,
        content,
        ...(expectedSha256 ? { expectedSha256 } : {}),
      });
    } catch (error) {
      if (error instanceof WorkspaceClientError && error.code === 'FILE_CHANGED') {
        this.shaByPath.delete(remotePath);
        throw new WorkspaceClientError(
          error.code,
          `[FILE_CHANGED] ${error.message}`,
          error.details,
          error.status,
        );
      }
      throw error;
    }
    this.shaByPath.set(remotePath, result.sha256);
  }

  private async exec(command: string, cwd: string, options: Parameters<BashOperations['exec']>[2]) {
    const executionId = randomUUID();
    const timeoutMs = options.timeout
      ? Math.ceil(options.timeout * 1_000)
      : DEFAULT_BASH_TIMEOUT_MS;
    const abort = options.signal;
    if (abort?.aborted) throw new Error('aborted');
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      void this.workspaceClient.process.cancel({ executionId }).catch(() => undefined);
    };
    abort?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await this.workspaceClient.process.exec({
        command: '/bin/bash',
        args: ['-lc', command],
        cwd: this.map(cwd),
        env: this.safeEnv.filter(options.env),
        timeoutMs,
        maxOutputBytes: DEFAULT_PROCESS_OUTPUT_BYTES,
        executionId,
      });
      if (result.stdout) options.onData(Buffer.from(result.stdout, 'utf8'));
      if (result.stderr) options.onData(Buffer.from(result.stderr, 'utf8'));
      if (aborted || result.status === 'aborted') return { exitCode: null };
      if (result.status === 'timeout')
        throw new WorkspaceClientError('PROCESS_TIMEOUT', `command timed out after ${timeoutMs}ms`);
      if (result.truncated)
        throw new WorkspaceClientError('OUTPUT_TRUNCATED', 'command output was truncated');
      return { exitCode: result.exitCode };
    } finally {
      abort?.removeEventListener('abort', onAbort);
    }
  }

  private async glob(pattern: string, cwd: string, ignore: string[], limit: number) {
    const remoteCwd = this.map(cwd);
    const args = ['--files', '--hidden', '--color=never', '--max-count', String(limit)];
    args.push('--glob', pattern);
    for (const value of ignore) args.push('--glob', value.startsWith('!') ? value : `!${value}`);
    const result = await this.workspaceClient.process.exec({
      command: 'rg',
      args,
      cwd: remoteCwd,
      timeoutMs: DEFAULT_BASH_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_PROCESS_OUTPUT_BYTES,
      executionId: randomUUID(),
    });
    if (result.status !== 'completed')
      throw new WorkspaceClientError(
        result.status === 'timeout' ? 'PROCESS_TIMEOUT' : 'PROCESS_ABORTED',
        'remote file search did not complete',
      );
    if (result.exitCode !== 0 && result.exitCode !== 1)
      throw new WorkspaceClientError(
        'INTERNAL_ERROR',
        result.stderr || 'remote file search failed',
      );
    return result.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit);
  }

  private map(input: string) {
    // Pi resolves paths with the host platform's separator. On Windows its
    // virtual /workspace cwd becomes "\\workspace"; normalize only that
    // known virtual form and keep rejecting real Windows drive paths.
    const normalizedHostPath = input.replaceAll('\\', '/');
    const driveVirtualPath = normalizedHostPath.match(/^[A-Za-z]:\/workspace(?:\/|$)/)
      ? normalizedHostPath.replace(/^[A-Za-z]:/i, '')
      : undefined;
    const piVirtualPath = normalizedHostPath.startsWith('/workspace')
      ? normalizedHostPath
      : (driveVirtualPath ?? input);
    return this.mapper.map(piVirtualPath);
  }
}

export type CloudCraneCodingTools = {
  read: ReturnType<typeof createReadToolDefinition>;
  edit: ReturnType<typeof createEditToolDefinition>;
  write: ReturnType<typeof createWriteToolDefinition>;
  bash: ReturnType<typeof createBashToolDefinition>;
  ls: ReturnType<typeof createLsToolDefinition>;
  find: ReturnType<typeof createFindToolDefinition>;
};

export function createCloudCraneCodingTools({
  workspaceClient,
  cwd = REMOTE_ROOT,
}: {
  workspaceClient: WorkspaceClient;
  cwd?: string;
}): CloudCraneCodingTools {
  const operations = new RemoteToolOperations(workspaceClient);
  return {
    read: createReadToolDefinition(cwd, { operations: operations.read }),
    edit: createEditToolDefinition(cwd, { operations: operations.edit }),
    write: createWriteToolDefinition(cwd, { operations: operations.write }),
    bash: createBashToolDefinition(cwd, {
      operations: operations.bash,
      exposeSessionEnvironment: false,
    }),
    ls: createLsToolDefinition(cwd, { operations: operations.ls }),
    find: createFindToolDefinition(cwd, { operations: operations.find }),
  };
}
