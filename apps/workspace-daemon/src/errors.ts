import type { WorkspaceError } from '@cloudcrane/workspace-protocol';
import { z } from 'zod';

export class WorkspaceDaemonError extends Error {
  constructor(
    public readonly code: WorkspaceError['code'],
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkspaceDaemonError';
  }
}

export function toWorkspaceError(error: unknown): WorkspaceDaemonError {
  if (error instanceof WorkspaceDaemonError) return error;
  if (error instanceof z.ZodError)
    return new WorkspaceDaemonError('INVALID_ARGUMENT', 'Request validation failed', {
      issues: error.issues,
    });
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  ) {
    return new WorkspaceDaemonError('FILE_NOT_FOUND', 'File or directory was not found');
  }
  return new WorkspaceDaemonError('INTERNAL_ERROR', 'Workspace daemon operation failed');
}
