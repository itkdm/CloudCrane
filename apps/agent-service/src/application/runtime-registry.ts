import { WebsiteAgentRuntime, type WebsiteAgentRuntimeOptions } from '@cloudcrane/website-agent';
import { AgentServiceError } from './errors.js';

export type WebsiteRuntimeBinding = Pick<
  WebsiteAgentRuntimeOptions,
  'websiteId' | 'workspaceId'
> & {
  previewSlug?: string | null;
  websiteStatus: string;
  workspaceStatus: string;
  previewPort?: number | null;
};

export interface WebsiteBindingStore {
  findWebsiteWorkspace(websiteId: string): Promise<WebsiteRuntimeBinding | null>;
}

export type WebsiteRuntimeRegistryOptions = {
  bindingStore: WebsiteBindingStore;
  createRuntime: (
    binding: WebsiteRuntimeBinding,
  ) => WebsiteAgentRuntime | Promise<WebsiteAgentRuntime>;
};

export class WebsiteRuntimeRegistry {
  private readonly runtimes = new Map<string, Promise<WebsiteAgentRuntime>>();
  private readonly disposing = new Set<string>();

  constructor(private readonly options: WebsiteRuntimeRegistryOptions) {}

  async get(websiteId: string): Promise<WebsiteAgentRuntime> {
    if (this.disposing.has(websiteId))
      throw new AgentServiceError('WEBSITE_DELETING', 'website is being deleted', 409);
    const existing = this.runtimes.get(websiteId);
    if (existing) return existing;
    const pending = this.create(websiteId);
    this.runtimes.set(websiteId, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.runtimes.get(websiteId) === pending) this.runtimes.delete(websiteId);
      throw error;
    }
  }

  async resolve(websiteId: string): Promise<WebsiteRuntimeBinding> {
    const binding = await this.options.bindingStore.findWebsiteWorkspace(websiteId);
    this.validateBinding(binding);
    return binding;
  }

  /**
   * Internal lifecycle operations need the Website/Workspace relationship before
   * the Website reaches the Agent-ready state. They must not instantiate an Agent
   * runtime or reuse the user-facing readiness validation above.
   */
  async resolveBinding(websiteId: string): Promise<WebsiteRuntimeBinding> {
    const binding = await this.options.bindingStore.findWebsiteWorkspace(websiteId);
    if (!binding) throw new AgentServiceError('WEBSITE_NOT_FOUND', 'website was not found', 404);
    if (binding.workspaceStatus === 'missing')
      throw new AgentServiceError('WORKSPACE_NOT_FOUND', 'website workspace was not found', 404);
    return binding;
  }

  get size(): number {
    return this.runtimes.size;
  }

  async dispose(websiteId: string): Promise<void> {
    this.disposing.add(websiteId);
    const pending = this.runtimes.get(websiteId);
    if (!pending) return;
    this.runtimes.delete(websiteId);
    await (await pending).shutdown();
  }

  forget(websiteId: string): void {
    this.runtimes.delete(websiteId);
    this.disposing.delete(websiteId);
  }

  async shutdown(): Promise<void> {
    const runtimes = await Promise.allSettled(this.runtimes.values());
    this.runtimes.clear();
    await Promise.all(
      runtimes
        .filter(
          (result): result is PromiseFulfilledResult<WebsiteAgentRuntime> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value.shutdown()),
    );
  }

  private async create(websiteId: string): Promise<WebsiteAgentRuntime> {
    const binding = await this.resolve(websiteId);
    return this.options.createRuntime(binding);
  }

  private validateBinding(
    binding: WebsiteRuntimeBinding | null,
  ): asserts binding is WebsiteRuntimeBinding {
    if (!binding) throw new AgentServiceError('WEBSITE_NOT_FOUND', 'website was not found', 404);
    if (
      ![
        'active',
        'ready',
        'authorization_required',
        'running',
        'ACTIVE',
        'READY',
        'RUNNING',
      ].includes(binding.websiteStatus)
    )
      throw new AgentServiceError('WEBSITE_NOT_FOUND', 'website is not available', 404);
    if (binding.workspaceStatus === 'missing')
      throw new AgentServiceError('WORKSPACE_NOT_FOUND', 'website workspace was not found', 404);
    if (
      !['created', 'running', 'ready', 'active', 'STARTED', 'RUNNING'].includes(
        binding.workspaceStatus,
      )
    )
      throw new AgentServiceError('WORKSPACE_NOT_READY', 'website workspace is not ready', 409);
  }
}
