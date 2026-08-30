import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentSession,
  type AgentSessionEvent,
  type AgentSessionEventListener,
  type AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
  type CreateAgentSessionRuntimeFactory,
} from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import { createCloudCraneCodingTools } from '@cloudcrane/pi-adapter';
import {
  WorkspaceClient,
  WorkspaceClientError,
  type WorkspaceClientContext,
} from '@cloudcrane/workspace-client';
import { ActiveSessionRegistry, type DisposableSession } from './registry.js';
import { AgentSessionPathLayout, assertUuid } from './paths.js';

const LOGICAL_CWD = '/workspace';
const REMOTE_AGENTS_MAX_BYTES = 65_536;
const APPEND_SYSTEM_PROMPT = [
  'CloudCrane agent constraints:',
  '- The working directory is the remote website workspace at /workspace.',
  '- Use the supplied remote tools for all workspace file and process operations.',
  '- Do not assume that the control-plane host filesystem is the website workspace.',
].join('\n');

export const AGENT_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'INTERRUPTED',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type WebsiteSessionStatus = 'OPEN' | 'CLOSED';

export type WebsiteSessionIndex = {
  id: string;
  websiteId: string;
  piSessionId: string;
  sessionFile: string;
  title: string | null;
  status: WebsiteSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
};

export type AgentRunIndex = {
  id: string;
  websiteId: string;
  sessionId: string;
  status: AgentRunStatus;
  model: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

export type CreateSessionIndex = Omit<WebsiteSessionIndex, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateRunIndex = Omit<AgentRunIndex, 'id'> & { id?: string };

export interface WebsiteAgentStore {
  findSession(websiteId: string, websiteSessionId: string): Promise<WebsiteSessionIndex | null>;
  createSession(input: CreateSessionIndex): Promise<WebsiteSessionIndex>;
  updateSession(websiteSessionId: string, patch: Partial<WebsiteSessionIndex>): Promise<void>;
  createRun(input: CreateRunIndex): Promise<AgentRunIndex>;
  updateRun(runId: string, patch: Partial<AgentRunIndex>): Promise<void>;
  recoverStaleRuns(websiteId: string): Promise<void>;
}

export type WorkspaceClientFactory = (
  contextProvider: () => WorkspaceClientContext,
) => WorkspaceClient;

export type WebsiteAgentRuntimeOptions = {
  websiteId: string;
  workspaceId: string;
  workspaceGatewayEndpoint: string;
  workspaceClientToken: string;
  agentDataRoot: string;
  store: WebsiteAgentStore;
  modelRuntime?: ModelRuntime;
  model?: Model<Api>;
  workspaceClientFactory?: WorkspaceClientFactory;
};

export type AgentRunResult = {
  runId: string;
  traceId: string;
  status: AgentRunStatus;
  finalText?: string;
};

export type WebsiteAgentEvent = {
  websiteId: string;
  websiteSessionId: string;
  piSessionId: string;
  runId?: string;
  traceId?: string;
  event: AgentSessionEvent;
};

type RunContext = { runId: string; traceId: string };
type ActiveRun = RunContext & { aborted: boolean };

class ManagedSession implements DisposableSession {
  private unsubscribe?: () => void;
  activeRun?: ActiveRun;

  constructor(
    readonly websiteSessionId: string,
    readonly record: WebsiteSessionIndex,
    readonly client: WorkspaceClient,
    public sessionManager: SessionManager,
    public piRuntime: AgentSessionRuntime,
    private readonly onEvent: (session: ManagedSession, event: AgentSessionEvent) => void,
  ) {}

  bind(): void {
    this.unsubscribe?.();
    const session = this.piRuntime.session;
    this.sessionManager = session.sessionManager;
    this.unsubscribe = session.subscribe((event) => this.onEvent(this, event));
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.piRuntime.dispose();
  }
}

export class WebsiteAgentRuntime {
  private readonly layout: AgentSessionPathLayout;
  private readonly sessions = new ActiveSessionRegistry<ManagedSession>();
  private readonly runContext = new AsyncLocalStorage<RunContext>();
  private readonly listeners = new Set<(event: WebsiteAgentEvent) => void>();
  private readonly settingsManager = SettingsManager.inMemory(undefined, { projectTrusted: false });
  private readonly agentDir: string;
  private readonly piCwd: string;
  private readonly baseContext: WorkspaceClientContext;
  private readonly workspaceClient: WorkspaceClient;
  private readonly modelRuntimePromise: Promise<ModelRuntime>;
  private remoteAgentsPromise?: Promise<Array<{ path: string; content: string }>>;

  constructor(private readonly options: WebsiteAgentRuntimeOptions) {
    assertUuid(options.websiteId, 'websiteId');
    assertUuid(options.workspaceId, 'workspaceId');
    this.layout = new AgentSessionPathLayout(options.agentDataRoot);
    this.agentDir = path.join(this.layout.root, options.websiteId, 'agent', 'pi');
    this.piCwd = path.join(this.layout.root, options.websiteId, 'agent', 'runtime-cwd');
    this.baseContext = { websiteId: options.websiteId, workspaceId: options.workspaceId };
    this.workspaceClient =
      options.workspaceClientFactory?.(() => this.currentContext()) ??
      new WorkspaceClient(
        options.workspaceGatewayEndpoint,
        options.workspaceClientToken,
        this.baseContext,
        undefined,
        () => this.currentContext(),
      );
    this.modelRuntimePromise = options.modelRuntime
      ? Promise.resolve(options.modelRuntime)
      : ModelRuntime.create({
          authPath: path.join(this.agentDir, 'auth.json'),
          modelsPath: null,
          allowModelNetwork: false,
          refreshOnCreate: false,
        });
  }

  subscribe(listener: (event: WebsiteAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createSession(): Promise<WebsiteSessionIndex> {
    await this.ensurePiCwd();
    const sessionManager = SessionManager.create(
      this.piCwd,
      this.layout.sessionDirectory(this.options.websiteId),
    );
    const sessionFile = sessionManager.getSessionFile();
    if (!sessionFile) throw new Error('Pi did not allocate a persistent session file');
    const record = await this.options.store.createSession({
      websiteId: this.options.websiteId,
      piSessionId: sessionManager.getSessionId(),
      sessionFile: this.layout.relativeSessionFile(this.options.websiteId, sessionFile),
      title: null,
      status: 'OPEN',
      lastActiveAt: null,
    });
    try {
      await this.sessions.getOrLoad(record.id, () => this.loadManaged(record, sessionManager));
      return record;
    } catch (error) {
      await this.options.store
        .updateSession(record.id, { status: 'CLOSED' })
        .catch(() => undefined);
      throw error;
    }
  }

  async openSession(websiteSessionId: string): Promise<WebsiteSessionIndex> {
    assertUuid(websiteSessionId, 'websiteSessionId');
    const record = await this.options.store.findSession(this.options.websiteId, websiteSessionId);
    if (!record) throw new Error('website session was not found');
    await this.sessions.getOrLoad(record.id, () => this.loadManaged(record));
    return record;
  }

  async prompt(websiteSessionId: string, text: string): Promise<AgentRunResult> {
    const managed = await this.getManaged(websiteSessionId);
    const runId = randomUUID();
    const traceId = randomUUID();
    const startedAt = new Date().toISOString();
    const run = await this.options.store.createRun({
      id: runId,
      websiteId: this.options.websiteId,
      sessionId: managed.websiteSessionId,
      status: 'PENDING',
      model: this.options.model ? `${this.options.model.provider}/${this.options.model.id}` : null,
      error: null,
      startedAt: null,
      endedAt: null,
    });
    const activeRun: ActiveRun = { runId: run.id, traceId, aborted: false };
    managed.activeRun = activeRun;
    await this.options.store.updateRun(run.id, { status: 'RUNNING', startedAt });
    let settled = false;
    let resolveSettled!: () => void;
    const settledPromise = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const onSettled: AgentSessionEventListener = (event) => {
      if (event.type === 'agent_settled') {
        settled = true;
        resolveSettled();
      }
    };
    const unsubscribe = managed.piRuntime.session.subscribe(onSettled);
    try {
      await this.runContext.run({ runId, traceId }, () => managed.piRuntime.session.prompt(text));
      if (!settled) await settledPromise;
      const status = this.getRunStatus(managed.piRuntime.session, activeRun);
      const endedAt = new Date().toISOString();
      await this.options.store.updateRun(run.id, { status, endedAt });
      await this.options.store.updateSession(managed.websiteSessionId, { lastActiveAt: endedAt });
      return {
        runId,
        traceId,
        status,
        finalText: managed.piRuntime.session.getLastAssistantText(),
      };
    } catch (error) {
      const status: AgentRunStatus = activeRun.aborted ? 'ABORTED' : 'FAILED';
      const message = error instanceof Error ? error.message.slice(0, 500) : 'agent run failed';
      await this.options.store.updateRun(run.id, {
        status,
        error: message,
        endedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      unsubscribe();
      if (managed.activeRun === activeRun) managed.activeRun = undefined;
    }
  }

  async abort(websiteSessionId: string): Promise<void> {
    const managed = await this.getManaged(websiteSessionId);
    if (managed.activeRun) managed.activeRun.aborted = true;
    await managed.piRuntime.session.abort();
  }

  async steer(websiteSessionId: string, text: string): Promise<void> {
    const managed = await this.getManaged(websiteSessionId);
    await this.withCurrentRun(managed, () => managed.piRuntime.session.steer(text));
  }

  async followUp(websiteSessionId: string, text: string): Promise<void> {
    const managed = await this.getManaged(websiteSessionId);
    await this.withCurrentRun(managed, () => managed.piRuntime.session.followUp(text));
  }

  async closeSession(websiteSessionId: string): Promise<void> {
    assertUuid(websiteSessionId, 'websiteSessionId');
    await this.sessions.close(websiteSessionId);
    await this.options.store.updateSession(websiteSessionId, {
      status: 'CLOSED',
      updatedAt: new Date().toISOString(),
    });
  }

  async newSession(websiteSessionId: string): Promise<WebsiteSessionIndex> {
    const managed = await this.getManaged(websiteSessionId);
    await managed.piRuntime.newSession();
    await this.persistSessionBinding(managed);
    return managed.record;
  }

  async switchSession(
    websiteSessionId: string,
    relativeSessionFile: string,
  ): Promise<WebsiteSessionIndex> {
    const managed = await this.getManaged(websiteSessionId);
    const absolute = this.layout.absoluteSessionFile(this.options.websiteId, relativeSessionFile);
    await managed.piRuntime.switchSession(absolute, { cwdOverride: this.piCwd });
    await this.persistSessionBinding(managed);
    return managed.record;
  }

  async recoverStaleRuns(): Promise<void> {
    await this.options.store.recoverStaleRuns(this.options.websiteId);
  }

  async disposeAll(): Promise<void> {
    await this.sessions.disposeAll();
  }

  async shutdown(): Promise<void> {
    await this.disposeAll();
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  private async getManaged(websiteSessionId: string): Promise<ManagedSession> {
    const record = await this.openSession(websiteSessionId);
    return this.sessions.getOrLoad(record.id, () => this.loadManaged(record));
  }

  private async loadManaged(
    record: WebsiteSessionIndex,
    manager?: SessionManager,
  ): Promise<ManagedSession> {
    const sessionManager =
      manager ??
      SessionManager.open(
        this.layout.absoluteSessionFile(this.options.websiteId, record.sessionFile),
        this.layout.sessionDirectory(this.options.websiteId),
        this.piCwd,
      );
    await this.ensurePiCwd();
    const modelRuntime = await this.modelRuntimePromise;
    const tools = createCloudCraneCodingTools({
      workspaceClient: this.workspaceClient,
      cwd: LOGICAL_CWD,
    });
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd,
      agentDir,
      sessionManager: nextSessionManager,
      sessionStartEvent,
    }) => {
      const agentsFiles = await this.loadRemoteAgents();
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager: this.settingsManager,
        resourceLoaderOptions: {
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          appendSystemPrompt: [APPEND_SYSTEM_PROMPT],
          agentsFilesOverride: () => ({ agentsFiles }),
        },
      });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager: nextSessionManager,
        model: this.options.model,
        thinkingLevel: 'off',
        noTools: 'builtin',
        customTools: Object.values(tools) as ToolDefinition[],
        sessionStartEvent,
      });
      return { ...result, services, diagnostics: services.diagnostics };
    };
    const piRuntime = await createAgentSessionRuntime(createRuntime, {
      cwd: this.piCwd,
      agentDir: this.agentDir,
      sessionManager,
    });
    const managed = new ManagedSession(
      record.id,
      record,
      this.workspaceClient,
      sessionManager,
      piRuntime,
      (current, event) => {
        this.emitEvent(current, event);
        if (event.type === 'session_info_changed') {
          void this.options.store.updateSession(current.websiteSessionId, {
            title: event.name ?? null,
            updatedAt: new Date().toISOString(),
          });
        }
      },
    );
    piRuntime.setRebindSession(async (session) => {
      managed.sessionManager = session.sessionManager;
      managed.bind();
      await this.persistSessionBinding(managed);
    });
    managed.bind();
    await this.persistSessionBinding(managed);
    return managed;
  }

  private async persistSessionBinding(managed: ManagedSession): Promise<void> {
    const sessionFile = managed.piRuntime.session.sessionFile;
    if (!sessionFile) throw new Error('Pi session is missing its persistent file');
    managed.record.piSessionId = managed.piRuntime.session.sessionId;
    managed.record.sessionFile = this.layout.relativeSessionFile(
      this.options.websiteId,
      sessionFile,
    );
    managed.record.updatedAt = new Date().toISOString();
    await this.options.store.updateSession(managed.websiteSessionId, {
      piSessionId: managed.record.piSessionId,
      sessionFile: managed.record.sessionFile,
      updatedAt: managed.record.updatedAt,
    });
  }

  private emitEvent(managed: ManagedSession, event: AgentSessionEvent): void {
    const context = this.runContext.getStore();
    const payload: WebsiteAgentEvent = {
      websiteId: this.options.websiteId,
      websiteSessionId: managed.websiteSessionId,
      piSessionId: managed.piRuntime.session.sessionId,
      runId: context?.runId ?? managed.activeRun?.runId,
      traceId: context?.traceId ?? managed.activeRun?.traceId,
      event,
    };
    for (const listener of this.listeners) listener(payload);
  }

  private currentContext(): WorkspaceClientContext {
    const context = this.runContext.getStore();
    return context
      ? { ...this.baseContext, traceId: context.traceId, agentRunId: context.runId }
      : this.baseContext;
  }

  private async withCurrentRun<T>(
    managed: ManagedSession,
    operation: () => Promise<T>,
  ): Promise<T> {
    const active = managed.activeRun;
    return active ? this.runContext.run(active, operation) : operation();
  }

  private async ensurePiCwd(): Promise<void> {
    await mkdir(this.piCwd, { recursive: true });
  }

  private getRunStatus(session: AgentSession, activeRun: ActiveRun): AgentRunStatus {
    const lastAssistant = [...session.agent.state.messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    if (activeRun.aborted || lastAssistant?.stopReason === 'aborted') return 'ABORTED';
    if (lastAssistant?.stopReason === 'error') return 'FAILED';
    return 'COMPLETED';
  }

  private loadRemoteAgents(): Promise<Array<{ path: string; content: string }>> {
    if (!this.remoteAgentsPromise) {
      this.remoteAgentsPromise = this.workspaceClient.fs
        .read({ path: '/workspace/AGENTS.md', maxBytes: REMOTE_AGENTS_MAX_BYTES })
        .then((result) => {
          if (result.truncated)
            throw new Error('remote AGENTS.md exceeds the allowed context size');
          return [{ path: '/workspace/AGENTS.md', content: result.content }];
        })
        .catch((error: unknown) => {
          if (error instanceof WorkspaceClientError && error.code === 'FILE_NOT_FOUND') return [];
          throw error;
        });
    }
    return this.remoteAgentsPromise!;
  }
}

export function createInMemoryWebsiteAgentStore(): WebsiteAgentStore {
  const sessions = new Map<string, WebsiteSessionIndex>();
  const runs = new Map<string, AgentRunIndex>();
  return {
    async findSession(websiteId, websiteSessionId) {
      const session = sessions.get(websiteSessionId);
      return session?.websiteId === websiteId ? { ...session } : null;
    },
    async createSession(input) {
      const now = new Date().toISOString();
      const session: WebsiteSessionIndex = {
        ...input,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(session.id, session);
      return { ...session };
    },
    async updateSession(websiteSessionId, patch) {
      const session = sessions.get(websiteSessionId);
      if (!session) throw new Error('website session was not found');
      Object.assign(session, patch, { updatedAt: patch.updatedAt ?? new Date().toISOString() });
    },
    async createRun(input) {
      const run: AgentRunIndex = { ...input, id: input.id ?? randomUUID() };
      runs.set(run.id, run);
      return { ...run };
    },
    async updateRun(runId, patch) {
      const run = runs.get(runId);
      if (!run) throw new Error('agent run was not found');
      Object.assign(run, patch);
    },
    async recoverStaleRuns(websiteId) {
      for (const run of runs.values()) {
        if (run.websiteId === websiteId && run.status === 'RUNNING') {
          run.status = 'INTERRUPTED';
          run.endedAt = new Date().toISOString();
        }
      }
    },
  };
}
