export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  status?: string;
  requestId?: string;
  attachments?: Array<{ id: string; kind: 'image' | 'document'; name: string; mimeType: string; size: number }>;
};

export type ConversationTurnStatus =
  'running' | 'completed' | 'error' | 'aborted' | 'no-final-text';

export type AssistantNarrativeStep = {
  kind: 'assistant';
  id: string;
  text: string;
  timestamp?: number;
  status: 'streaming' | 'completed';
};

export type QuestionInteraction = {
  kind: 'question';
  interactionId: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  allowCustom: true;
  status?: 'pending' | 'submitting' | 'answered' | 'cancelled';
  answer?: string;
  wasCustom?: boolean;
  error?: string;
};

export type ReferenceUploadInteraction = {
  kind: 'reference_upload';
  interactionId: string;
  accept: ['.zip'];
  maxBytes?: number;
  status?: 'pending' | 'uploading' | 'completed' | 'cancelled';
  error?: string;
  referenceId?: string;
  name?: string;
  logicalPath?: string;
};

export type ToolInteraction = QuestionInteraction | ReferenceUploadInteraction;

export type ToolExecutionStep = {
  kind: 'tool';
  id: string;
  toolCallId: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  status: 'running' | 'completed' | 'error';
  interaction?: ToolInteraction;
};

export type ContextMaintenanceExecutionStep = {
  kind: 'context-maintenance';
  id: string;
  operation: 'compaction';
  status: 'running' | 'completed' | 'error';
};

export type ExecutionStep =
  AssistantNarrativeStep | ToolExecutionStep | ContextMaintenanceExecutionStep;

export type ConversationTurn = {
  userMessage: Message;
  runId?: string;
  execution?: ExecutionStep[];
  finalAnswer?: Message;
  status: ConversationTurnStatus;
  error?: string;
  expanded: boolean;
};

export type ManualMaintenanceItem = {
  id: string;
  operation: 'compaction';
  status: 'running' | 'completed' | 'error';
  afterTurnId?: string;
};

export type Session = {
  id: string;
  title: string | null;
  pinnedAt?: string | null;
  lastActiveAt?: string | null;
  clonedFromSessionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

export type PreviewState = {
  status: 'loading' | 'ready' | 'unavailable' | 'stopped';
  url?: string;
  path?: string;
  message?: string;
};

export type WorkbenchErrorSource = 'command' | 'connection' | 'session' | 'preview-explicit';

export type WorkbenchError = {
  source: WorkbenchErrorSource;
  message: string;
  code?: string;
  requestId?: string;
  runId?: string;
};

export function shouldClearErrorOnRunSettled(
  error: WorkbenchError | undefined,
  runId: string | undefined,
): boolean {
  return Boolean(error?.runId && runId && error.runId === runId);
}

export function shouldClearErrorOnRecovery(error: WorkbenchError | undefined): boolean {
  return (
    error?.source === 'connection' ||
    error?.source === 'preview-explicit' ||
    (error?.source === 'command' &&
      error.code === 'INVALID_ARGUMENT' &&
      /Preview response is not pending|Preview Client is not registered/i.test(error.message))
  );
}
