import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ProcessExecRequest, ProcessExecResponse } from '@cloudcrane/workspace-protocol';
import { WorkspaceDaemonError } from './errors.js';
import { WorkspacePathResolver } from './workspace-path-resolver.js';

type ActiveExecution = { child: ChildProcess; cancelled: boolean };

export class ProcessService {
  private readonly active = new Map<string, ActiveExecution>();

  constructor(private readonly resolver: WorkspacePathResolver) {}

  async exec(request: ProcessExecRequest): Promise<ProcessExecResponse> {
    const cwd = await this.resolver.resolve(request.cwd, { mustExist: true, directory: true });
    const started = performance.now();
    const executionId = request.executionId || randomUUID();
    const child = spawn(request.command, request.args, {
      cwd,
      detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', ...request.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const execution: ActiveExecution = { child, cancelled: false };
    this.active.set(executionId, execution);
    let stdout = '';
    let stderr = '';
    let truncated = false;
    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const remaining = request.maxOutputBytes - (stdout.length + stderr.length);
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const value = chunk.subarray(0, remaining).toString('utf8');
      if (target === 'stdout') stdout += value;
      else stderr += value;
      if (value.length < chunk.byteLength) truncated = true;
    };
    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      this.kill(execution);
    }, request.timeoutMs);
    const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
      },
    ).finally(() => clearTimeout(timeout));
    this.active.delete(executionId);
    const durationMs = Math.round(performance.now() - started);
    if (timedOut)
      throw new WorkspaceDaemonError('PROCESS_TIMEOUT', 'Process exceeded its timeout', {
        executionId,
        durationMs,
      });
    if (execution.cancelled)
      throw new WorkspaceDaemonError('PROCESS_ABORTED', 'Process was cancelled', {
        executionId,
        durationMs,
      });
    return {
      executionId,
      stdout,
      stderr,
      exitCode: result.exitCode,
      durationMs,
      truncated,
      status: 'completed',
    };
  }

  cancel(executionId: string): { executionId: string; cancelled: boolean; status: 'aborted' } {
    const execution = this.active.get(executionId);
    if (!execution) return { executionId, cancelled: false, status: 'aborted' };
    execution.cancelled = true;
    this.kill(execution);
    return { executionId, cancelled: true, status: 'aborted' };
  }

  private kill(execution: ActiveExecution): void {
    const pid = execution.child.pid;
    if (pid && process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGKILL');
        return;
      } catch {
        /* fall back to child */
      }
    }
    execution.child.kill('SIGKILL');
  }
}
