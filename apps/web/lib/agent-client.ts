import {
  agentEventSchema,
  agentWireMessageSchema,
  type AgentCommand,
  type AgentEvent,
  type AgentEnvelope,
  type AgentWireMessage,
} from '@cloudcrane/agent-protocol';

const serviceUrl = process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ?? 'http://localhost:4101';

export type AgentSession = {
  id: string;
  title: string | null;
  status: 'NEW' | 'ACTIVE' | 'CLOSED';
  piSessionId: string;
  pinnedAt: string | null;
  clonedFromSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
};

function agentEndpoint(path: string): string {
  return `${serviceUrl.replace(/\/$/, '')}${path}`;
}

export async function listAgentSessions(websiteId: string) {
  const response = await fetch(agentEndpoint(`/v1/websites/${websiteId}/sessions`), {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { sessions: AgentSession[] };
}

export async function createAgentSession(websiteId: string) {
  const response = await fetch(agentEndpoint(`/v1/websites/${websiteId}/sessions`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { session: AgentSession };
}

export async function updateAgentSession(
  websiteId: string,
  sessionId: string,
  patch: { title?: string; pinned?: boolean },
) {
  const response = await fetch(agentEndpoint(`/v1/websites/${websiteId}/sessions/${sessionId}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { session: AgentSession };
}

export async function cloneAgentSession(websiteId: string, sessionId: string) {
  const response = await fetch(
    agentEndpoint(`/v1/websites/${websiteId}/sessions/${sessionId}/clone`),
    { method: 'POST', credentials: 'include' },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { session: AgentSession };
}

export async function deleteAgentSession(websiteId: string, sessionId: string) {
  const response = await fetch(agentEndpoint(`/v1/websites/${websiteId}/sessions/${sessionId}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export async function uploadReference(
  websiteId: string,
  sessionId: string,
  interactionId: string,
  file: File,
) {
  const body = new FormData();
  body.append('file', file, file.name);
  const response = await fetch(
    agentEndpoint(
      `/v1/websites/${websiteId}/sessions/${sessionId}/interactions/${interactionId}/reference-upload`,
    ),
    { method: 'POST', body, credentials: 'include' },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as {
    referenceId: string;
    name: string;
    logicalPath: string;
    sha256: string;
    size: number;
  };
}

export async function uploadAttachment(websiteId: string, sessionId: string, file: File) {
  const body = new FormData();
  body.append('file', file, file.name);
  const response = await fetch(
    agentEndpoint(`/v1/websites/${websiteId}/sessions/${sessionId}/attachments`),
    { method: 'POST', body, credentials: 'include' },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as {
    id: string;
    kind: 'image' | 'document';
    name: string;
    mimeType: string;
    size: number;
    sha256: string;
  };
}

export function agentWebSocketUrl(): string {
  if (/^https?:\/\//.test(serviceUrl)) {
    return `${serviceUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/agent/connect`;
  }

  if (typeof window === 'undefined') {
    return `${serviceUrl.replace(/\/$/, '')}/v1/agent/connect`;
  }

  const url = new URL(agentEndpoint('/v1/agent/connect'), window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function parseAgentMessage(raw: string): AgentWireMessage | null {
  try {
    const parsed = agentWireMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseAgentEvent(
  message: AgentWireMessage,
): { event: AgentEvent; envelope: AgentEnvelope } | null {
  const parsed = agentEventSchema.safeParse({ type: message.type, payload: message.payload });
  return parsed.success ? { event: parsed.data, envelope: message } : null;
}

export async function getPreviewUrl(websiteId: string) {
  const response = await fetch(agentEndpoint(`/v1/websites/${websiteId}/preview`), {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { url: string; expiresAt: number };
}

export function command(input: Omit<AgentCommand, 'requestId' | 'timestamp'>): AgentCommand {
  return { ...input, requestId: crypto.randomUUID(), timestamp: new Date() } as AgentCommand;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Agent Service returned ${response.status}`;
  } catch {
    return `Agent Service returned ${response.status}`;
  }
}
