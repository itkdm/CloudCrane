export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  status?: string;
  requestId?: string;
};

export type ConversationTurnStatus =
  'running' | 'completed' | 'error' | 'aborted' | 'no-final-text';

export type AssistantNarrativeStep = {
  kind: 'assistant';
  id: string;
  text: string;
  status: 'streaming' | 'completed';
};

export type ToolExecutionStep = {
  kind: 'tool';
  id: string;
  toolCallId: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  status: 'running' | 'completed' | 'error';
};

export type ExecutionStep = AssistantNarrativeStep | ToolExecutionStep;

export type ConversationTurn = {
  userMessage: Message;
  execution?: ExecutionStep[];
  finalAnswer?: Message;
  status: ConversationTurnStatus;
  error?: string;
  expanded: boolean;
};

export type Session = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PreviewState = {
  status: 'loading' | 'ready' | 'unavailable' | 'stopped';
  url?: string;
  path?: string;
  message?: string;
};
