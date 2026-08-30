import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceDaemonError } from './errors.js';

const VIRTUAL_ROOT = '/workspace';

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export class WorkspacePathResolver {
  private readonly root: string;
  private rootRealpathPromise?: Promise<string>;

  constructor(root = process.env.WORKSPACE_ROOT ?? VIRTUAL_ROOT) {
    this.root = path.resolve(root);
  }

  async resolve(
    input: string,
    options: { mustExist?: boolean; directory?: boolean } = {},
  ): Promise<string> {
    if (!input || input.includes('\0') || !path.posix.isAbsolute(input) || !isVirtualPath(input)) {
      throw new WorkspaceDaemonError('PATH_OUT_OF_SCOPE', 'Path must be inside /workspace');
    }

    const relative = input.slice(VIRTUAL_ROOT.length).replace(/^[/\\]+/, '');
    const candidate = path.resolve(this.root, relative);
    const rootRealpath = await this.getRootRealpath();
    if (!isWithin(this.root, candidate)) {
      throw new WorkspaceDaemonError('PATH_OUT_OF_SCOPE', 'Path escapes /workspace');
    }

    let candidateRealpath: string;
    try {
      candidateRealpath = await realpath(candidate);
    } catch (error) {
      if (options.mustExist || !isNotFound(error)) {
        if (isNotFound(error))
          throw new WorkspaceDaemonError('FILE_NOT_FOUND', 'Path was not found');
        throw error;
      }
      const parentRealpath = await this.resolveExistingParent(candidate, rootRealpath);
      candidateRealpath = path.join(parentRealpath, path.basename(candidate));
    }

    if (!isWithin(rootRealpath, candidateRealpath)) {
      throw new WorkspaceDaemonError('PATH_OUT_OF_SCOPE', 'Symlink escapes /workspace');
    }
    if (options.directory && options.mustExist) {
      const stats = await lstat(candidateRealpath);
      if (!stats.isDirectory())
        throw new WorkspaceDaemonError('INVALID_ARGUMENT', 'Path must be a directory');
    }
    return candidate;
  }

  async resolveExisting(input: string): Promise<string> {
    return this.resolve(input, { mustExist: true });
  }

  private async getRootRealpath(): Promise<string> {
    this.rootRealpathPromise ??= realpath(this.root);
    return this.rootRealpathPromise;
  }

  private async resolveExistingParent(candidate: string, rootRealpath: string): Promise<string> {
    let current = path.dirname(candidate);
    while (true) {
      try {
        const existing = await realpath(current);
        if (!isWithin(rootRealpath, existing)) {
          throw new WorkspaceDaemonError('PATH_OUT_OF_SCOPE', 'Parent symlink escapes /workspace');
        }
        return existing;
      } catch (error) {
        if (!isNotFound(error) || current === this.root) throw error;
        current = path.dirname(current);
      }
    }
  }
}

function isVirtualPath(input: string): boolean {
  return input === VIRTUAL_ROOT || input.startsWith(`${VIRTUAL_ROOT}/`);
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT',
  );
}
