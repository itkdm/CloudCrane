import {
  agentEventSchema,
  agentWireMessageSchema,
  type AgentCommand,
  type AgentEvent,
  type AgentEnvelope,
  type AgentWireMessage,
} from '@cloudcrane/agent-protocol';

const serviceUrl = process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ?? 'http://localhost:4101';

export async function listAgentSessions(websiteId: string) {
  const response = await fetch(`${serviceUrl}/v1/websites/${websiteId}/sessions`);
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as {
    sessions: Array<{ id: string; title: string | null; createdAt: string; updatedAt: string }>;
  };
}

export async function createAgentSession(websiteId: string) {
  const response = await fetch(`${serviceUrl}/v1/websites/${websiteId}/sessions`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as {
    session: { id: string; title: string | null; createdAt: string; updatedAt: string };
  };
}

export function agentWebSocketUrl(): string {
  return `${serviceUrl.replace(/^http/, 'ws')}/v1/agent/connect`;
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
  const response = await fetch(`${serviceUrl}/v1/websites/${websiteId}/preview`);
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
