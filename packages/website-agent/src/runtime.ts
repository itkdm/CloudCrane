import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
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
  type InlineExtension,
  type ToolDefinition,
  type CreateAgentSessionRuntimeFactory,
} from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { createCloudCraneCodingTools } from '@cloudcrane/pi-adapter';
import { createLogger } from '@cloudcrane/shared';
import { deriveSessionTitle } from '@cloudcrane/shared/session-title';
import {
  WorkspaceClient,
  WorkspaceClientError,
  type WorkspaceClientContext,
} from '@cloudcrane/workspace-client';
import { ActiveSessionRegistry, type DisposableSession } from './registry.js';
import { AgentSessionPathLayout, assertUuid } from './paths.js';
import {
  createPreviewTools,
  type PreviewObservationContext,
  type PreviewObservationProvider,
} from './preview.js';
import { CLOUDCRANE_SYSTEM_PROMPT } from './system-prompt.js';
import {
  HumanInteractionBroker,
  type HumanInteractionOption,
  type QuestionInteraction,
  type QuestionResponse,
} from './human-interaction-broker.js';

const LOGICAL_CWD = '/workspace';
const REMOTE_AGENTS_MAX_BYTES = 65_536;
const REMOTE_SKILLS_ROOT = '/workspace/.agents/skills';
const REMOTE_REFERENCE_ROOT = '/workspace/.cloudcrane/references/template-source';
const REMOTE_SKILL_FILE_MAX_BYTES = 262_144;
const REMOTE_SKILLS_TOTAL_MAX_BYTES = 2_097_152;
const MAX_TURN_INDEX = 1_000_000;
const logger = createLogger('website-agent');

export const AGENT_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'INTERRUPTED',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type WebsiteSessionStatus = 'NEW' | 'ACTIVE' | 'CLOSED';

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
  traceId: string;
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
  listSessions(websiteId: string): Promise<WebsiteSessionIndex[]>;
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
  previewObservationProvider?: PreviewObservationProvider;
};

export type AgentRunResult = {
  runId: string;
  traceId: string;
  status: AgentRunStatus;
  finalText?: string;
};

export type WebsiteAgentMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolCallId?: string;
  toolName?: string;
  input?: string;
  output?: string;
  isError?: boolean;
  turnId?: string;
  kind?: string;
  status?: 'running' | 'completed' | 'error';
};

export type ContextMaintenanceState = {
  operation: 'compaction';
  status: 'running';
};

export type WebsiteAgentSessionSnapshot = {
  session: WebsiteSessionIndex;
  messages: WebsiteAgentMessage[];
  contextMaintenance: ContextMaintenanceState | null;
  activeRun: (RunContext & { status: 'RUNNING' }) | null;
  pendingInteractions: QuestionInteraction[];
};

export type WebsiteAgentInteractionEvent = {
  type: 'interaction_requested';
  interaction: QuestionInteraction;
};

export type WebsiteAgentLifecycleEvent =
  | {
      type: 'run_started';
      runId: string;
      traceId: string;
      previewClientId?: string;
      promptRequestId?: string;
    }
  | {
      type: 'run_settled';
      runId: string;
      traceId: string;
      status: Extract<AgentRunStatus, 'COMPLETED' | 'FAILED' | 'ABORTED' | 'INTERRUPTED'>;
      error?: string;
      finalMessageId?: string;
    };

export type WebsiteAgentCompactionEvent = {
  type: 'context_compaction';
  status: 'started' | 'completed' | 'failed' | 'not_needed';
};

export type WebsiteAgentEvent = {
  websiteId: string;
  websiteSessionId: string;
  piSessionId: string;
  runId?: string;
  traceId?: string;
  turnIndex?: number;
  turnId?: string;
  event:
    | AgentSessionEvent
    | WebsiteAgentLifecycleEvent
    | WebsiteAgentCompactionEvent
    | WebsiteAgentInteractionEvent;
};

type RunContext = {
  runId: string;
  traceId: string;
  previewClientId?: string;
  promptRequestId?: string;
};
type ActiveRun = RunContext & { aborted: boolean };
type PrimaryOperation = 'run' | 'manual-compaction';

type RemoteAgentResources = {
  agentsFiles: Array<{ path: string; content: string }>;
  skillsDir: string;
  skillNames: string[];
};

export class WebsiteAgentRuntimeError extends Error {
  constructor(
    public readonly code:
      | 'SESSION_BUSY'
      | 'WEBSITE_MUTATION_BUSY'
      | 'CONTEXT_COMPACTION_NOT_NEEDED'
      | 'INTERACTION_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'WebsiteAgentRuntimeError';
  }
}

class ProcessMutationLeaseRegistry {
  private readonly owners = new Map<string, string>();

  tryAcquire(websiteId: string, runId: string): boolean {
    const owner = this.owners.get(websiteId);
    if (owner && owner !== runId) return false;
    this.owners.set(websiteId, runId);
    return true;
  }

  release(websiteId: string, runId: string): void {
    if (this.owners.get(websiteId) === runId) this.owners.delete(websiteId);
  }
}

const processMutationLeases = new ProcessMutationLeaseRegistry();

function wrapMutationTool(
  tool: ToolDefinition,
  websiteId: string,
  getRunContext: () => RunContext | undefined,
): ToolDefinition {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, context) => {
      const run = getRunContext();
      if (!run)
        throw new WebsiteAgentRuntimeError(
          'WEBSITE_MUTATION_BUSY',
          '[WEBSITE_MUTATION_BUSY] mutating workspace tools require an active AgentRun',
        );
      if (!processMutationLeases.tryAcquire(websiteId, run.runId))
        throw new WebsiteAgentRuntimeError(
          'WEBSITE_MUTATION_BUSY',
          '[WEBSITE_MUTATION_BUSY] another AgentRun is currently mutating this Website workspace',
        );
      return tool.execute(toolCallId, params, signal, onUpdate, context);
    },
  };
}

class ManagedSession implements DisposableSession {
  private unsubscribe?: () => void;
  private nextTurnIndex = 0;
  private turnRunId?: string;
  private currentTurnIndex?: number;
  private currentTurnId?: string;
  compactionStatus?: 'running';
  activeRun?: ActiveRun;
  private primaryOperation?: PrimaryOperation;

  tryReservePrimaryOperation(operation: PrimaryOperation): boolean {
    if (
      this.primaryOperation ||
      this.activeRun ||
      this.compactionStatus ||
      this.piRuntime.session.isCompacting
    )
      return false;
    this.primaryOperation = operation;
    return true;
  }

  releasePrimaryOperation(operation: PrimaryOperation): void {
    if (this.primaryOperation === operation) this.primaryOperation = undefined;
  }

  isSessionBusy(): boolean {
    return Boolean(
      this.primaryOperation ||
      this.activeRun ||
      this.compactionStatus ||
      this.piRuntime.session.isCompacting,
    );
  }

  constructor(
    readonly websiteSessionId: string,
    readonly record: WebsiteSessionIndex,
    readonly client: WorkspaceClient,
    public sessionManager: SessionManager,
    public piRuntime: AgentSessionRuntime,
    private readonly refreshResources: () => Promise<void>,
    private readonly onEvent: (
      session: ManagedSession,
      event: AgentSessionEvent,
      metadata: { turnIndex?: number; turnId?: string },
    ) => void,
  ) {}

  async reloadResources(): Promise<void> {
    await this.refreshResources();
    await this.piRuntime.session.reload();
    const diagnostics = this.piRuntime.services.resourceLoader.getSkills().diagnostics;
    if (diagnostics.length > 0)
      logger.warn(
        { websiteId: this.record.websiteId, diagnosticCount: diagnostics.length },
        'remote website skills loaded with diagnostics',
      );
  }

  bind(): void {
    this.unsubscribe?.();
    const session = this.piRuntime.session;
    this.sessionManager = session.sessionManager;
    this.unsubscribe = session.subscribe((event) => {
      const metadata = this.trackTurn(event);
      this.onEvent(this, event, metadata);
      if (event.type === 'turn_end') {
        this.nextTurnIndex = (metadata.turnIndex ?? this.nextTurnIndex) + 1;
        this.currentTurnIndex = undefined;
        this.currentTurnId = undefined;
      } else if (event.type === 'agent_end') {
        this.currentTurnIndex = undefined;
        this.currentTurnId = undefined;
      }
    });
  }

  private trackTurn(event: AgentSessionEvent): { turnIndex?: number; turnId?: string } {
    if (event.type === 'agent_start') {
      if (this.turnRunId !== this.activeRun?.runId) {
        this.turnRunId = this.activeRun?.runId;
        this.nextTurnIndex = 0;
        this.currentTurnIndex = undefined;
        this.currentTurnId = undefined;
      }
      return {};
    }
    if (event.type === 'turn_start') {
      this.currentTurnIndex = boundedTurnIndex(this.nextTurnIndex);
      this.currentTurnId = this.createTurnId(this.currentTurnIndex);
    } else if (event.type === 'turn_end' && this.currentTurnIndex === undefined) {
      this.currentTurnIndex = boundedTurnIndex(this.nextTurnIndex);
      this.currentTurnId = this.createTurnId(this.currentTurnIndex);
    }
    return { turnIndex: this.currentTurnIndex, turnId: this.currentTurnId };
  }

  private createTurnId(turnIndex: number | undefined): string | undefined {
    return turnIndex === undefined
      ? undefined
      : `${this.activeRun?.runId ?? this.piRuntime.session.sessionId}:turn:${turnIndex}`;
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
  private readonly interactionBroker: HumanInteractionBroker;

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
    this.interactionBroker = new HumanInteractionBroker((interaction) => {
      this.emitInteraction(interaction);
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
      status: 'NEW',
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

  async listSessions(): Promise<WebsiteSessionIndex[]> {
    return this.options.store.listSessions(this.options.websiteId);
  }

  async getSessionSnapshot(websiteSessionId: string): Promise<WebsiteAgentSessionSnapshot> {
    const managed = await this.getManaged(websiteSessionId);
    return {
      session: { ...managed.record },
      messages: projectSessionHistory(managed.sessionManager.getBranch()),
      contextMaintenance: managed.compactionStatus
        ? { operation: 'compaction', status: 'running' }
        : null,
      activeRun: managed.activeRun
        ? {
            runId: managed.activeRun.runId,
            traceId: managed.activeRun.traceId,
            previewClientId: managed.activeRun.previewClientId,
            promptRequestId: managed.activeRun.promptRequestId,
            status: 'RUNNING',
          }
        : null,
      pendingInteractions: this.interactionBroker.listPending(
        this.options.websiteId,
        managed.websiteSessionId,
      ),
    };
  }

  respondInteraction(
    interactionId: string,
    websiteSessionId: string,
    response: QuestionResponse,
  ): void {
    if (
      !this.interactionBroker.respond(
        interactionId,
        this.options.websiteId,
        websiteSessionId,
        response,
      )
    )
      throw new WebsiteAgentRuntimeError(
        'INTERACTION_NOT_FOUND',
        'interaction is not pending for this session',
      );
  }

  cancelInteraction(interactionId: string, websiteSessionId: string): void {
    if (!this.interactionBroker.cancel(interactionId, this.options.websiteId, websiteSessionId))
      throw new WebsiteAgentRuntimeError(
        'INTERACTION_NOT_FOUND',
        'interaction is not pending for this session',
      );
  }

  async prompt(
    websiteSessionId: string,
    text: string,
    previewClientId?: string,
    promptRequestId?: string,
    onAccepted?: () => void,
  ): Promise<AgentRunResult> {
    const managed = await this.getManaged(websiteSessionId);
    if (!managed.tryReservePrimaryOperation('run'))
      throw new WebsiteAgentRuntimeError(
        'SESSION_BUSY',
        'this WebsiteSession already has an active AgentRun; use steer or followUp',
      );
    try {
      await managed.reloadResources();
      await this.ensureSessionTitle(managed, text);
      const runId = randomUUID();
      const traceId = randomUUID();
      const startedAt = new Date().toISOString();
      const activeRun: ActiveRun = {
        runId,
        traceId,
        previewClientId,
        promptRequestId,
        aborted: false,
      };
      managed.activeRun = activeRun;
      let run: AgentRunIndex | undefined;
      try {
        run = await this.options.store.createRun({
          id: runId,
          websiteId: this.options.websiteId,
          sessionId: managed.websiteSessionId,
          traceId,
          status: 'PENDING',
          model: this.options.model
            ? `${this.options.model.provider}/${this.options.model.id}`
            : null,
          error: null,
          startedAt: null,
          endedAt: null,
        });
        await this.options.store.updateRun(run.id, { status: 'RUNNING', startedAt });
        onAccepted?.();
        this.emitLifecycle(managed, {
          type: 'run_started',
          runId,
          traceId,
          previewClientId,
          ...(promptRequestId ? { promptRequestId } : {}),
        });
      } catch (error) {
        if (run) {
          await this.options.store
            .updateRun(run.id, {
              status: 'FAILED',
              error: error instanceof Error ? error.message.slice(0, 500) : 'run bootstrap failed',
              endedAt: new Date().toISOString(),
            })
            .catch(() => undefined);
        }
        if (managed.activeRun === activeRun) managed.activeRun = undefined;
        throw error;
      }
      let settled = false;
      let settledEventEmitted = false;
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
        await this.runContext.run(activeRun, () => managed.piRuntime.session.prompt(text));
        if (!settled) await settledPromise;
        const status = this.getRunStatus(managed.piRuntime.session, activeRun);
        const endedAt = new Date().toISOString();
        await this.options.store.updateRun(run.id, { status, endedAt });
        const sessionStatus = managed.sessionManager.isPersisted()
          ? 'ACTIVE'
          : managed.record.status;
        managed.record.status = sessionStatus;
        await this.options.store.updateSession(managed.websiteSessionId, {
          status: sessionStatus,
          lastActiveAt: endedAt,
        });
        settledEventEmitted = true;
        const finalMessageId = getFinalAssistantMessageId(
          managed.piRuntime.session.agent.state.messages,
        );
        this.emitLifecycle(managed, {
          type: 'run_settled',
          runId,
          traceId,
          status,
          ...(finalMessageId ? { finalMessageId } : {}),
        });
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
        if (!settledEventEmitted) {
          this.emitLifecycle(managed, {
            type: 'run_settled',
            runId,
            traceId,
            status,
            error: message,
          });
        }
        throw error;
      } finally {
        unsubscribe();
        processMutationLeases.release(this.options.websiteId, activeRun.runId);
        if (managed.activeRun === activeRun) managed.activeRun = undefined;
      }
    } finally {
      managed.releasePrimaryOperation('run');
    }
  }

  async abort(websiteSessionId: string): Promise<void> {
    const managed = await this.getManaged(websiteSessionId);
    if (managed.activeRun) managed.activeRun.aborted = true;
    await managed.piRuntime.session.abort();
  }

  async compact(websiteSessionId: string): Promise<void> {
    const managed = await this.getManaged(websiteSessionId);
    if (!managed.tryReservePrimaryOperation('manual-compaction'))
      throw new WebsiteAgentRuntimeError(
        'SESSION_BUSY',
        'this WebsiteSession is busy and cannot compact its context',
      );

    managed.compactionStatus = 'running';
    this.emitCompaction(managed, 'started');
    try {
      await managed.piRuntime.session.compact();
      if (managed.compactionStatus) {
        managed.compactionStatus = undefined;
        this.emitCompaction(managed, 'completed');
      }
    } catch (error) {
      if (managed.compactionStatus) {
        managed.compactionStatus = undefined;
        const notNeeded = isCompactionNotNeededError(error);
        this.emitCompaction(managed, notNeeded ? 'not_needed' : 'failed');
      }
      if (isCompactionNotNeededError(error))
        throw new WebsiteAgentRuntimeError(
          'CONTEXT_COMPACTION_NOT_NEEDED',
          'this conversation has no earlier context that needs organizing',
        );
      throw error;
    } finally {
      managed.releasePrimaryOperation('manual-compaction');
    }
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

  async newSession(sourceWebsiteSessionId?: string): Promise<WebsiteSessionIndex> {
    if (sourceWebsiteSessionId) await this.openSession(sourceWebsiteSessionId);
    return this.createSession();
  }

  async switchSession(
    websiteSessionId: string,
    targetWebsiteSessionId?: string,
  ): Promise<WebsiteSessionIndex> {
    assertUuid(websiteSessionId, 'websiteSessionId');
    const targetId = targetWebsiteSessionId ?? websiteSessionId;
    return this.openSession(targetId);
  }

  async recoverStaleRuns(): Promise<void> {
    await this.options.store.recoverStaleRuns(this.options.websiteId);
  }

  async disposeAll(): Promise<void> {
    await this.sessions.disposeAll();
  }

  async shutdown(): Promise<void> {
    this.interactionBroker.cancelAll();
    await this.disposeAll();
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  async hasActiveRun(websiteSessionId: string): Promise<boolean> {
    return Boolean((await this.getManaged(websiteSessionId)).activeRun);
  }

  async isSessionBusy(websiteSessionId: string): Promise<boolean> {
    return (await this.getManaged(websiteSessionId)).isSessionBusy();
  }

  async getSystemPrompt(websiteSessionId: string): Promise<string> {
    const managed = await this.getManaged(websiteSessionId);
    return managed.piRuntime.session.agent.state.systemPrompt;
  }

  private async getManaged(websiteSessionId: string): Promise<ManagedSession> {
    const record = await this.openSession(websiteSessionId);
    return this.sessions.getOrLoad(record.id, () => this.loadManaged(record));
  }

  private async loadManaged(
    record: WebsiteSessionIndex,
    manager?: SessionManager,
  ): Promise<ManagedSession> {
    const sessionManager = manager ?? (await this.openOrRecreateSession(record));
    await this.ensurePiCwd();
    const modelRuntime = await this.modelRuntimePromise;
    const rawTools = createCloudCraneCodingTools({
      workspaceClient: this.workspaceClient,
      cwd: LOGICAL_CWD,
    });
    const previewTools = this.options.previewObservationProvider
      ? createPreviewTools(this.options.previewObservationProvider, () =>
          this.currentPreviewContext(record.id),
        )
      : {};
    const tools = {
      ...rawTools,
      ...previewTools,
      edit: wrapMutationTool(
        rawTools.edit as unknown as ToolDefinition,
        this.options.websiteId,
        () => this.runContext.getStore(),
      ),
      write: wrapMutationTool(
        rawTools.write as unknown as ToolDefinition,
        this.options.websiteId,
        () => this.runContext.getStore(),
      ),
      bash: wrapMutationTool(
        rawTools.bash as unknown as ToolDefinition,
        this.options.websiteId,
        () => this.runContext.getStore(),
      ),
      question: createQuestionTool(
        this.interactionBroker,
        () => {
          const run = this.runContext.getStore();
          return run
            ? {
                runId: run.runId,
                sessionId: record.id,
                piSessionId: sessionManager.getSessionId(),
              }
            : undefined;
        },
        this.options.websiteId,
      ),
    };
    const modelFacingCwdExtension: InlineExtension = {
      name: 'cloudcrane-logical-cwd',
      hidden: true,
      factory: (pi) => {
        pi.on('before_agent_start', ({ systemPrompt }) => ({
          systemPrompt: replaceModelFacingCwd(
            systemPrompt.replaceAll(remoteResources.skillsDir, REMOTE_SKILLS_ROOT),
            this.piCwd,
          ),
        }));
      },
    };
    const remoteResources: RemoteAgentResources = {
      agentsFiles: [],
      skillsDir: this.remoteSkillsDir(),
      skillNames: [],
    };
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd,
      agentDir,
      sessionManager: nextSessionManager,
      sessionStartEvent,
    }) => {
      remoteResources.agentsFiles = await this.loadRemoteAgents();
      await this.refreshRemoteSkills(remoteResources.skillsDir, remoteResources.skillNames);
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager: this.settingsManager,
        resourceLoaderOptions: {
          noExtensions: true,
          noSkills: true,
          additionalSkillPaths: [remoteResources.skillsDir],
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          systemPromptOverride: () => CLOUDCRANE_SYSTEM_PROMPT,
          appendSystemPromptOverride: () => [],
          extensionFactories: [modelFacingCwdExtension],
          agentsFilesOverride: () => ({ agentsFiles: remoteResources.agentsFiles }),
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
      async () => {
        remoteResources.agentsFiles = await this.loadRemoteAgents();
        await this.refreshRemoteSkills(remoteResources.skillsDir, remoteResources.skillNames);
      },
      (current, event, metadata) => {
        this.emitEvent(current, event, metadata);
        if (event.type === 'compaction_start') {
          const alreadyRunning = current.compactionStatus === 'running';
          current.compactionStatus = 'running';
          if (!alreadyRunning) this.emitCompaction(current, 'started');
        } else if (event.type === 'compaction_end') {
          current.compactionStatus = undefined;
          const status = isCompactionNotNeededError(event.errorMessage)
            ? 'not_needed'
            : event.aborted
              ? 'failed'
              : event.errorMessage
                ? 'failed'
                : 'completed';
          this.emitCompaction(current, status);
        }
        if (event.type === 'session_info_changed') {
          const title = event.name?.trim() || null;
          if (current.record.title === title) return;
          current.record.title = title;
          void this.options.store.updateSession(current.websiteSessionId, {
            title,
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
    await this.synchronizeSessionName(managed);
    await this.persistSessionBinding(managed);
    return managed;
  }

  private async ensureSessionTitle(managed: ManagedSession, prompt: string): Promise<void> {
    const existingTitle =
      managed.record.title?.trim() || managed.piRuntime.session.sessionName?.trim();
    if (existingTitle) {
      if (managed.record.title !== existingTitle) {
        managed.record.title = existingTitle;
        await this.options.store.updateSession(managed.websiteSessionId, {
          title: existingTitle,
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }

    const title = deriveSessionTitle(prompt);
    managed.record.title = title;
    try {
      managed.piRuntime.session.setSessionName(title);
    } catch (error) {
      logger.warn(
        {
          websiteId: this.options.websiteId,
          websiteSessionId: managed.websiteSessionId,
          error: error instanceof Error ? error.message : 'unknown error',
        },
        'pi session name unavailable; persisted WebsiteSession title',
      );
    }
    await this.options.store.updateSession(managed.websiteSessionId, {
      title,
      updatedAt: new Date().toISOString(),
    });
  }

  private async synchronizeSessionName(managed: ManagedSession): Promise<void> {
    const websiteTitle = managed.record.title?.trim();
    const piTitle = managed.piRuntime.session.sessionName?.trim();
    if (!websiteTitle && !piTitle) return;
    const title = websiteTitle ?? piTitle;
    if (!title) return;

    managed.record.title = title;
    if (piTitle !== title) {
      try {
        managed.piRuntime.session.setSessionName(title);
      } catch (error) {
        logger.warn(
          {
            websiteId: this.options.websiteId,
            websiteSessionId: managed.websiteSessionId,
            error: error instanceof Error ? error.message : 'unknown error',
          },
          'pi session name could not be synchronized',
        );
      }
    }
    if (managed.record.title !== websiteTitle)
      await this.options.store.updateSession(managed.websiteSessionId, {
        title,
        updatedAt: new Date().toISOString(),
      });
  }

  private async persistSessionBinding(managed: ManagedSession): Promise<void> {
    const sessionFile = managed.piRuntime.session.sessionFile;
    if (!sessionFile) throw new Error('Pi session is missing its persistent file');
    if (managed.record.piSessionId !== managed.piRuntime.session.sessionId)
      throw new Error('Pi session identity changed for an existing WebsiteSession');
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

  private emitEvent(
    managed: ManagedSession,
    event: AgentSessionEvent,
    metadata: { turnIndex?: number; turnId?: string },
  ): void {
    const context = this.runContext.getStore();
    const payload: WebsiteAgentEvent = {
      websiteId: this.options.websiteId,
      websiteSessionId: managed.websiteSessionId,
      piSessionId: managed.piRuntime.session.sessionId,
      runId: context?.runId ?? managed.activeRun?.runId,
      traceId: context?.traceId ?? managed.activeRun?.traceId,
      ...metadata,
      event,
    };
    for (const listener of this.listeners) listener(payload);
  }

  private emitInteraction(interaction: QuestionInteraction): void {
    this.listeners.forEach((listener) =>
      listener({
        websiteId: this.options.websiteId,
        websiteSessionId: interaction.sessionId,
        piSessionId: interaction.piSessionId ?? interaction.sessionId,
        runId: interaction.runId,
        event: { type: 'interaction_requested', interaction },
      }),
    );
  }

  private emitLifecycle(managed: ManagedSession, event: WebsiteAgentLifecycleEvent): void {
    const payload: WebsiteAgentEvent = {
      websiteId: this.options.websiteId,
      websiteSessionId: managed.websiteSessionId,
      piSessionId: managed.piRuntime.session.sessionId,
      runId: event.runId,
      traceId: event.traceId,
      event,
    };
    for (const listener of this.listeners) listener(payload);
  }

  private emitCompaction(
    managed: ManagedSession,
    status: WebsiteAgentCompactionEvent['status'],
  ): void {
    const context = this.runContext.getStore();
    const payload: WebsiteAgentEvent = {
      websiteId: this.options.websiteId,
      websiteSessionId: managed.websiteSessionId,
      piSessionId: managed.piRuntime.session.sessionId,
      runId: context?.runId ?? managed.activeRun?.runId,
      traceId: context?.traceId ?? managed.activeRun?.traceId,
      event: { type: 'context_compaction', status },
    };
    for (const listener of this.listeners) listener(payload);
  }

  private currentContext(): WorkspaceClientContext {
    const context = this.runContext.getStore();
    return context
      ? { ...this.baseContext, traceId: context.traceId, agentRunId: context.runId }
      : this.baseContext;
  }

  private currentPreviewContext(websiteSessionId: string): PreviewObservationContext | undefined {
    const context = this.runContext.getStore();
    if (!context) return undefined;
    return {
      websiteId: this.options.websiteId,
      websiteSessionId,
      runId: context.runId,
      traceId: context.traceId,
      previewClientId: context.previewClientId,
    };
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

  private getRunStatus(
    session: AgentSession,
    activeRun: ActiveRun,
  ): Extract<AgentRunStatus, 'COMPLETED' | 'FAILED' | 'ABORTED' | 'INTERRUPTED'> {
    const lastAssistant = [...session.agent.state.messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    if (activeRun.aborted || lastAssistant?.stopReason === 'aborted') return 'ABORTED';
    if (lastAssistant?.stopReason === 'error') return 'FAILED';
    return 'COMPLETED';
  }

  private async loadRemoteAgents(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    try {
      const result = await this.workspaceClient.fs.read({
        path: '/workspace/AGENTS.md',
        maxBytes: REMOTE_AGENTS_MAX_BYTES,
      });
      if (result.truncated) throw new Error('remote AGENTS.md exceeds the allowed context size');
      files.push({ path: '/workspace/AGENTS.md', content: result.content });
    } catch (error: unknown) {
      if (!(error instanceof WorkspaceClientError && error.code === 'FILE_NOT_FOUND')) throw error;
    }
    try {
      const reference = await this.workspaceClient.fs.stat({ path: REMOTE_REFERENCE_ROOT });
      if (reference.type === 'directory')
        files.push({
          path: `${REMOTE_REFERENCE_ROOT}/README.md`,
          content: [
            'Migration reference is available at `/workspace/.cloudcrane/references/template-source`.',
            'It is a read-only source snapshot. Analyze it with read-only tools; never write, delete, execute, or deploy it.',
            'The writable target is `/workspace`.',
          ].join('\n'),
        });
    } catch (error: unknown) {
      if (!(error instanceof WorkspaceClientError && error.code === 'FILE_NOT_FOUND')) throw error;
    }
    return files;
  }

  private remoteSkillsDir(): string {
    return path.join(this.layout.root, this.options.websiteId, 'agent', 'remote-skills');
  }

  private async refreshRemoteSkills(targetDir: string, previousNames: string[]): Promise<void> {
    const stagingDir = `${targetDir}.staging-${randomUUID()}`;
    const backupDir = `${targetDir}.backup-${randomUUID()}`;
    const files: Array<{ remotePath: string; relativePath: string; size: number }> = [];
    let totalBytes = 0;
    let skippedFiles = 0;
    let incompleteRefresh = false;
    try {
      await this.collectRemoteSkillFiles(REMOTE_SKILLS_ROOT, '', files);
      const eligibleFiles: typeof files = [];
      for (const file of files) {
        if (file.size > REMOTE_SKILL_FILE_MAX_BYTES) {
          skippedFiles++;
          continue;
        }
        totalBytes += file.size;
        if (totalBytes > REMOTE_SKILLS_TOTAL_MAX_BYTES) {
          totalBytes -= file.size;
          skippedFiles++;
          continue;
        }
        eligibleFiles.push(file);
      }
      await mkdir(stagingDir, { recursive: true });
      for (const file of eligibleFiles) {
        let result;
        try {
          result = await this.workspaceClient.fs.read({
            path: file.remotePath,
            maxBytes: REMOTE_SKILL_FILE_MAX_BYTES,
          });
        } catch {
          skippedFiles++;
          incompleteRefresh = true;
          logger.warn(
            { websiteId: this.options.websiteId, path: file.relativePath },
            'remote skill file could not be read; skipping',
          );
          continue;
        }
        if (result.truncated) {
          skippedFiles++;
          incompleteRefresh = true;
          continue;
        }
        const localPath = path.join(stagingDir, ...file.relativePath.split('/'));
        await mkdir(path.dirname(localPath), { recursive: true });
        await writeFile(localPath, result.content, 'utf8');
      }
      if (incompleteRefresh) throw new Error('remote skill mirror would be incomplete');
      let hadPreviousMirror = false;
      try {
        await rename(targetDir, backupDir);
        hadPreviousMirror = true;
      } catch (error) {
        if (!isFileNotFound(error)) throw error;
      }
      try {
        await rename(stagingDir, targetDir);
      } catch (error) {
        if (hadPreviousMirror) await rename(backupDir, targetDir).catch(() => undefined);
        throw error;
      }
      if (hadPreviousMirror) await rm(backupDir, { recursive: true, force: true });
      previousNames.splice(
        0,
        previousNames.length,
        ...eligibleFiles.flatMap((file) => {
          if (!file.relativePath.endsWith('/SKILL.md')) return [];
          const [name] = file.relativePath.split('/');
          return name ? [name] : [];
        }),
      );
      logger.info(
        {
          websiteId: this.options.websiteId,
          skillCount: previousNames.length,
          skillNames: previousNames,
          totalBytes,
          skippedFiles,
        },
        'remote website skills refreshed',
      );
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof WorkspaceClientError && error.code === 'FILE_NOT_FOUND') {
        await rm(targetDir, { recursive: true, force: true });
        await mkdir(targetDir, { recursive: true });
        previousNames.splice(0, previousNames.length);
        return;
      }
      logger.warn(
        {
          websiteId: this.options.websiteId,
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
        },
        'remote website skills refresh failed; retaining previous mirror',
      );
    }
  }

  private async collectRemoteSkillFiles(
    remoteDir: string,
    relativeDir: string,
    files: Array<{ remotePath: string; relativePath: string; size: number }>,
  ): Promise<void> {
    const result = await this.workspaceClient.fs.list({ path: remoteDir });
    for (const entry of result.entries) {
      const name = entry.path.slice(remoteDir.length).replace(/^\/+/, '');
      if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..')
        throw new Error(`invalid remote skill path: ${entry.path}`);
      const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
      if (entry.type === 'directory') {
        await this.collectRemoteSkillFiles(entry.path, relativePath, files);
      } else if (entry.type === 'file') {
        files.push({ remotePath: entry.path, relativePath, size: entry.size });
      }
    }
  }

  private async openOrRecreateSession(record: WebsiteSessionIndex): Promise<SessionManager> {
    const sessionFile = this.layout.absoluteSessionFile(this.options.websiteId, record.sessionFile);
    try {
      await access(sessionFile);
      return SessionManager.open(
        sessionFile,
        this.layout.sessionDirectory(this.options.websiteId),
        this.piCwd,
      );
    } catch (error: unknown) {
      if (!isFileNotFound(error)) throw error;
      return SessionManager.create(
        this.piCwd,
        this.layout.sessionDirectory(this.options.websiteId),
        { id: record.piSessionId },
      );
    }
  }
}

function isCompactionNotNeededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /^(?:Compaction failed: )?(Nothing to compact \(session too small\)|Already compacted)$/.test(
    message.trim(),
  );
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function replaceModelFacingCwd(systemPrompt: string, internalCwd: string): string {
  const logicalLine = `Current working directory: ${LOGICAL_CWD}`;
  const replaced = systemPrompt.replace(/^Current working directory: .*$/m, logicalLine);
  const withLine = replaced.includes(logicalLine) ? replaced : `${logicalLine}\n\n${replaced}`;
  return withLine.replaceAll(internalCwd, LOGICAL_CWD);
}

export function createInMemoryWebsiteAgentStore(): WebsiteAgentStore {
  const sessions = new Map<string, WebsiteSessionIndex>();
  const runs = new Map<string, AgentRunIndex>();
  return {
    async findSession(websiteId, websiteSessionId) {
      const session = sessions.get(websiteSessionId);
      return session?.websiteId === websiteId ? { ...session } : null;
    },
    async listSessions(websiteId) {
      return [...sessions.values()]
        .filter((session) => session.websiteId === websiteId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((session) => ({ ...session }));
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
        if (run.websiteId === websiteId && (run.status === 'PENDING' || run.status === 'RUNNING')) {
          run.status = 'INTERRUPTED';
          run.endedAt = new Date().toISOString();
        }
      }
    },
  };
}

export function projectMessages(messages: readonly unknown[]): WebsiteAgentMessage[] {
  const projected: WebsiteAgentMessage[] = [];
  const toolsByCallId = new Map<string, WebsiteAgentMessage>();
  let turnIndex = 0;
  let hasUserMessage = false;
  let turnId = `turn-${turnIndex}`;
  messages.forEach((message, messageIndex) => {
    if (!message || typeof message !== 'object') return;
    const value = message as {
      role?: unknown;
      content?: unknown;
      id?: unknown;
      timestamp?: unknown;
      turnId?: unknown;
      kind?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      isError?: unknown;
    };
    if (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'toolResult') return;
    if (value.role === 'user') {
      if (hasUserMessage) turnIndex = Math.min(turnIndex + 1, MAX_TURN_INDEX);
      hasUserMessage = true;
      turnId = readString(value.turnId) ?? `turn-${turnIndex}`;
    }
    const content = Array.isArray(value.content) ? value.content : [];
    const text = extractMessageText(value.content);
    const messageTurnId = readString(value.turnId) ?? turnId;
    if (value.role === 'toolResult') {
      const toolCallId = readString(value.toolCallId);
      const toolName = readString(value.toolName);
      const isError = typeof value.isError === 'boolean' ? value.isError : false;
      const output = summarizeText(text);
      const existing = toolCallId ? toolsByCallId.get(toolCallId) : undefined;
      if (existing) {
        existing.output = output;
        existing.text = output ?? '';
        existing.isError = isError;
        existing.status = isError ? 'error' : 'completed';
        if (toolName && !existing.toolName) existing.toolName = toolName;
      } else {
        const tool: WebsiteAgentMessage = {
          id: toolCallId ? `tool-${toolCallId}` : stableMessageId(value, messageIndex),
          role: 'tool',
          text: output ?? '',
          ...(toolCallId ? { toolCallId } : {}),
          ...(toolName ? { toolName } : {}),
          ...(output ? { output } : {}),
          isError,
          turnId: messageTurnId,
          kind: readString(value.kind) ?? 'tool_result',
          status: isError ? 'error' : 'completed',
        };
        projected.push(tool);
        if (toolCallId) toolsByCallId.set(toolCallId, tool);
      }
      return;
    }
    if (text) {
      const role: 'user' | 'assistant' = value.role;
      projected.push({
        id: stableMessageId(value, messageIndex),
        role,
        text,
        turnId: messageTurnId,
        kind: readString(value.kind) ?? 'message',
      });
    }
    for (const [partIndex, part] of content.entries()) {
      if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'toolCall')
        continue;
      const toolCall = part as { id?: unknown; name?: unknown; arguments?: unknown };
      const toolCallId = readString(toolCall.id);
      const input = summarize(toolCall.arguments);
      const tool: WebsiteAgentMessage = {
        id: toolCallId ?? `${stableMessageId(value, messageIndex)}-tool-${partIndex}`,
        role: 'tool',
        text: '',
        ...(toolCallId ? { toolCallId } : {}),
        ...(readString(toolCall.name) ? { toolName: readString(toolCall.name) } : {}),
        ...(input ? { input } : {}),
        turnId: messageTurnId,
        kind: 'tool_call',
        status: 'running',
      };
      projected.push(tool);
      if (toolCallId) toolsByCallId.set(toolCallId, tool);
    }
  });
  return projected;
}

function projectSessionHistory(entries: readonly unknown[]): WebsiteAgentMessage[] {
  const messages = entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || (entry as { type?: unknown }).type !== 'message')
      return [];
    const message = (entry as { message?: unknown }).message;
    return message ? [message] : [];
  });
  return projectMessages(messages);
}

const questionParameters = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 1_000 }),
  options: Type.Array(
    Type.Object({
      label: Type.String({ minLength: 1, maxLength: 200 }),
      description: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    { minItems: 1, maxItems: 8 },
  ),
});

function createQuestionTool(
  broker: HumanInteractionBroker,
  getContext: () => { runId: string; sessionId: string; piSessionId: string } | undefined,
  websiteId: string,
): ToolDefinition<typeof questionParameters> {
  return {
    name: 'question',
    label: 'Question',
    description:
      'Ask the user for a decision only when continuing genuinely requires their choice. Do not use this for decisions you can reasonably make yourself.',
    promptSnippet: 'ask the user for a necessary choice',
    promptGuidelines: [
      'Use question only when a real user decision is required to continue.',
      'Do not ask questions whose answer is already clear from the user request or workspace.',
    ],
    parameters: questionParameters,
    executionMode: 'sequential',
    execute: async (toolCallId, params, signal) => {
      const context = getContext();
      if (!context) throw new Error('question requires an active AgentRun');
      const interaction = await broker.requestQuestion(
        {
          kind: 'question',
          websiteId,
          sessionId: context.sessionId,
          runId: context.runId,
          toolCallId,
          question: params.question,
          options: params.options as HumanInteractionOption[],
          allowCustom: true,
          piSessionId: context.piSessionId,
        },
        signal,
      );
      if (interaction.type === 'cancelled')
        return {
          content: [{ type: 'text', text: 'User cancelled the question' }],
          details: { answer: null, wasCustom: false },
        };
      if (interaction.type === 'custom')
        return {
          content: [{ type: 'text', text: `User provided: ${interaction.value}` }],
          details: { answer: interaction.value, wasCustom: true },
        };
      const option = params.options[interaction.optionIndex];
      return {
        content: [{ type: 'text', text: `User selected: ${option?.label ?? 'unknown'}` }],
        details: {
          answer: option?.label ?? '',
          wasCustom: false,
          optionIndex: interaction.optionIndex,
        },
      };
    },
  };
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 32_000);
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: 'text'; text: string } =>
      Boolean(
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
      ),
    )
    .map((part) => part.text)
    .join('')
    .slice(0, 32_000);
}

function summarizeText(value: string): string | undefined {
  return value ? redactSecrets(value).slice(0, 512) : undefined;
}

function summarize(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return summarizeText(text);
  } catch {
    return '[summary unavailable]';
  }
}

function redactSecrets(value: string): string {
  return value.replace(
    /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)(\s*[:=]\s*)(["']?)[^\s,"'}]+\3/gi,
    '$1$2$3[redacted]$3',
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stableMessageId(
  value: { id?: unknown; role?: unknown; timestamp?: unknown },
  index: number,
): string {
  const sourceId = readString(value.id);
  if (sourceId) return sourceId;
  if (typeof value.timestamp === 'number' && Number.isFinite(value.timestamp))
    return `pi:${readString(value.role) ?? 'message'}:${value.timestamp}`;
  return `message-${index}`;
}

function getFinalAssistantMessageId(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = messages[index];
    if (!value || typeof value !== 'object') continue;
    const message = value as {
      role?: unknown;
      content?: unknown;
      timestamp?: unknown;
      id?: unknown;
    };
    if (message.role !== 'assistant' || hasToolCall(message)) continue;
    if (!extractMessageText(message.content)) continue;
    return stableMessageId(message, index);
  }
  return undefined;
}

function hasToolCall(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const content = (message as { content?: unknown }).content;
  return (
    Array.isArray(content) &&
    content.some(
      (part) =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'toolCall',
    )
  );
}

function boundedTurnIndex(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TURN_INDEX ? value : 0;
}
