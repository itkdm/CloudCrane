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

export type Session = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PreviewState = {
  status: 'loading' | 'ready' | 'unavailable' | 'stopped';
  url?: string;
  message?: string;
};
