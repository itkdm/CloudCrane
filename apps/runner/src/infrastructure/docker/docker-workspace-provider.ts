import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import { z } from 'zod';
import type { RunnerConfig } from '../../config.js';
import type { WorkspaceProvider, WorkspaceRuntime } from '../../ports/workspace-provider.js';

export class DockerWorkspaceProvider implements WorkspaceProvider {
  constructor(
    private readonly config: RunnerConfig,
    private readonly docker = new Docker(),
  ) {}

  async create(workspaceId: string): Promise<WorkspaceRuntime> {
    this.assertWorkspaceId(workspaceId);
    const persistentPath = this.persistentPath(workspaceId);
    await mkdir(persistentPath, { recursive: true });
    await this.provisionWorkspaceOwnership(persistentPath, workspaceId);
    const network = await this.docker.createNetwork({
      Name: `cloudcrane-workspace-${workspaceId}`,
      Driver: 'bridge',
      Internal: false,
    });
    let container: Docker.Container | undefined;
    try {
      container = await this.docker.createContainer({
        Image: this.config.workspaceImage,
        name: `cloudcrane-workspace-${workspaceId}`,
        User: '1000:1000',
        WorkingDir: '/workspace',
        Env: [
          `WORKSPACE_ID=${workspaceId}`,
          'WORKSPACE_DAEMON_PORT=7070',
          'WORKSPACE_DAEMON_HOST=0.0.0.0',
        ],
        ExposedPorts: { '7070/tcp': {} },
        HostConfig: {
          Binds: [`${persistentPath}:/workspace`],
          NetworkMode: network.id,
          PortBindings: { '7070/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }] },
          Privileged: false,
          PidMode: '',
          IpcMode: '',
          SecurityOpt: ['no-new-privileges:true'],
          NanoCpus: this.config.cpuLimit,
          Memory: this.config.memoryLimitBytes,
          PidsLimit: this.config.pidsLimit,
          AutoRemove: false,
        },
      });
      await container.start();
      return this.runtime(workspaceId, container.id, 'running');
    } catch (error) {
      await container?.remove({ force: true }).catch(() => undefined);
      await network.remove().catch(() => undefined);
      throw error;
    }
  }

  async start(workspaceId: string): Promise<WorkspaceRuntime> {
    const container = await this.container(workspaceId);
    await container.start();
    return this.runtime(workspaceId, container.id, 'running');
  }
  async stop(workspaceId: string): Promise<WorkspaceRuntime> {
    const container = await this.container(workspaceId);
    await container.stop();
    return this.runtime(workspaceId, container.id, 'stopped');
  }

  async getStatus(workspaceId: string): Promise<WorkspaceRuntime> {
    const container = await this.container(workspaceId);
    const info = await container.inspect();
    const status = info.State?.Running ? 'running' : 'stopped';
    return this.runtime(workspaceId, container.id, status);
  }

  async getEndpoint(workspaceId: string): Promise<string> {
    const container = await this.container(workspaceId);
    const info = await container.inspect();
    const binding = info.NetworkSettings?.Ports?.['7070/tcp']?.[0];
    if (!binding?.HostPort) throw new Error('Workspace daemon endpoint is unavailable');
    return `http://127.0.0.1:${binding.HostPort}`;
  }

  async destroyRuntime(workspaceId: string): Promise<void> {
    const container = await this.container(workspaceId);
    const info = await container.inspect();
    if (info.State?.Running) await container.stop().catch(() => undefined);
    await container.remove({ force: true });
    if (info.HostConfig?.NetworkMode) {
      await this.docker
        .getNetwork(info.HostConfig.NetworkMode)
        .remove()
        .catch(() => undefined);
    }
  }

  private async container(workspaceId: string): Promise<Docker.Container> {
    this.assertWorkspaceId(workspaceId);
    return this.docker.getContainer(`cloudcrane-workspace-${workspaceId}`);
  }
  private async runtime(
    workspaceId: string,
    containerRef: string,
    status: WorkspaceRuntime['status'],
  ): Promise<WorkspaceRuntime> {
    return { workspaceId, containerRef, status, endpoint: await this.getEndpoint(workspaceId) };
  }
  private persistentPath(workspaceId: string): string {
    return `${this.config.workspaceRoot}/${workspaceId}/workspace`;
  }
  private async provisionWorkspaceOwnership(
    persistentPath: string,
    workspaceId: string,
  ): Promise<void> {
    const ownerContainer = await this.docker.createContainer({
      Image: this.config.workspaceImage,
      name: `cloudcrane-workspace-owner-${workspaceId}-${randomUUID()}`,
      User: '0:0',
      Entrypoint: ['/usr/bin/chown'],
      Cmd: ['-R', '1000:1000', '/workspace'],
      HostConfig: {
        Binds: [`${persistentPath}:/workspace`],
        NetworkMode: 'none',
        AutoRemove: false,
      },
    });
    try {
      await ownerContainer.start();
      const result = await ownerContainer.wait();
      if (result.StatusCode !== 0) {
        throw new Error(`Workspace ownership provisioning failed (${result.StatusCode})`);
      }
    } finally {
      await ownerContainer.remove({ force: true }).catch(() => undefined);
    }
  }
  private assertWorkspaceId(workspaceId: string): void {
    if (!z.string().uuid().safeParse(workspaceId).success)
      throw new Error('Invalid internal workspace id');
  }
}
