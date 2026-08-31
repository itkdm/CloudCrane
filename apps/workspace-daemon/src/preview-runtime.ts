import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

const PREVIEW_PORT = 8080;
const MAX_LOG_BYTES = 8_192;

export type PreviewRuntimeStatus = 'starting' | 'ready' | 'stopped' | 'error';

export class WorkspacePreviewRuntime {
  private child?: ChildProcess;
  private status: PreviewRuntimeStatus = 'stopped';
  private stdoutBytes = 0;
  private stderrBytes = 0;

  async start(): Promise<void> {
    if (this.status === 'ready' || this.status === 'starting') return;
    this.status = 'starting';
    this.stdoutBytes = 0;
    this.stderrBytes = 0;
    const child = spawn('php', ['-S', `0.0.0.0:${PREVIEW_PORT}`, '-t', '/workspace'], {
      cwd: '/workspace',
      detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutBytes = Math.min(MAX_LOG_BYTES, this.stdoutBytes + chunk.byteLength);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBytes = Math.min(MAX_LOG_BYTES, this.stderrBytes + chunk.byteLength);
    });
    child.once('error', () => {
      this.status = 'error';
    });
    child.once('exit', () => {
      if (this.status !== 'stopped') this.status = 'error';
    });
    await this.waitForReady();
    this.status = 'ready';
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.status = 'stopped';
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    } else child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  info() {
    return { status: this.status, port: PREVIEW_PORT };
  }

  private async waitForReady(): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (this.status === 'error')
        throw new Error('workspace preview server exited during startup');
      const ready = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port: PREVIEW_PORT });
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => {
          socket.destroy();
          resolve(false);
        });
      });
      if (ready) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('workspace preview server did not become ready');
  }
}
