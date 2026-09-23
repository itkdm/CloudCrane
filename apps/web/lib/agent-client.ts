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

export type ModelProfile = {
  id: string;
  providerKind: 'builtin' | 'openai-compatible';
  presetId: string | null;
  providerId: string;
  modelId: string;
  displayName: string;
  baseUrl: string | null;
  api: string | null;
  keyHint: string;
  isDefault: boolean;
  input: Array<'text' | 'image'>;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  supportsTools: boolean;
};

export type ModelPreset = {
  id: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  api: string;
  models: Array<{
    id: string;
    name: string;
    input: Array<'text' | 'image'>;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
    supportsTools: boolean;
  }>;
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

export async function listModelProfiles() {
  const response = await fetch(agentEndpoint('/v1/model-profiles'), { credentials: 'include' });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { profiles: ModelProfile[] };
}

export async function listModelCatalog() {
  const response = await fetch(agentEndpoint('/v1/model-catalog'), { credentials: 'include' });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { presets: ModelPreset[] };
}

export async function createModelProfile(input: {
  providerKind: ModelProfile['providerKind'];
  presetId?: string;
  providerId: string;
  modelId: string;
  displayName?: string;
  baseUrl?: string;
  api?: string;
  apiKey: string;
  input?: Array<'text' | 'image'>;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  isDefault?: boolean;
}) {
  const response = await fetch(agentEndpoint('/v1/model-profiles'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { profile: ModelProfile };
}

export async function deleteModelProfile(profileId: string) {
  const response = await fetch(agentEndpoint(`/v1/model-profiles/${profileId}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export async function updateModelProfile(
  profileId: string,
  input: {
    providerKind: ModelProfile['providerKind'];
    presetId?: string;
    providerId: string;
    modelId: string;
    displayName?: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    input?: Array<'text' | 'image'>;
    reasoning?: boolean;
    contextWindow?: number;
    maxTokens?: number;
  },
) {
  const response = await fetch(agentEndpoint(`/v1/model-profiles/${profileId}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as { profile: ModelProfile };
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

const attachmentUploadKeys = new Map<string, string>();
const attachmentUploadKeyPrefix = 'cloudcrane:attachment-upload-key:';
type UploadedAttachment = {
  id: string;
  kind: 'image' | 'document';
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
};

function isUploadedAttachment(value: unknown): value is UploadedAttachment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    (item.kind === 'image' || item.kind === 'document') &&
    typeof item.name === 'string' &&
    typeof item.mimeType === 'string' &&
    typeof item.size === 'number' &&
    item.size > 0 &&
    typeof item.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(item.sha256)
  );
}

function getStoredAttachmentUploadKey(operationKey: string) {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(attachmentUploadKeyPrefix + operationKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function setStoredAttachmentUploadKey(operationKey: string, idempotencyKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(attachmentUploadKeyPrefix + operationKey, idempotencyKey);
  } catch {
    // Upload retries still work within the current page through the in-memory map.
  }
}

function removeStoredAttachmentUploadKey(operationKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(attachmentUploadKeyPrefix + operationKey);
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export async function uploadAttachment(websiteId: string, sessionId: string, file: File) {
  const body = new FormData();
  body.append('file', file, file.name);
  const contentSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const operationKey = `${websiteId}:${sessionId}:${file.name}:${file.size}:${file.lastModified}:${contentSha256}`;
  const idempotencyKey =
    attachmentUploadKeys.get(operationKey) ??
    getStoredAttachmentUploadKey(operationKey) ??
    crypto.randomUUID();
  attachmentUploadKeys.set(operationKey, idempotencyKey);
  setStoredAttachmentUploadKey(operationKey, idempotencyKey);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5 * 60 * 1000);
  try {
    const response = await fetch(
      agentEndpoint(`/v1/websites/${websiteId}/sessions/${sessionId}/attachments`),
      {
        method: 'POST',
        body,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'Idempotency-Key': idempotencyKey,
          'X-Attachment-Sha256': contentSha256,
        },
      },
    );
    if (!response.ok) throw new Error(await errorMessage(response));
    const result: unknown = await response.json();
    if (!isUploadedAttachment(result)) throw new Error('Invalid attachment upload response');
    attachmentUploadKeys.delete(operationKey);
    removeStoredAttachmentUploadKey(operationKey);
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function deleteAttachment(websiteId: string, sessionId: string, attachmentId: string) {
  const response = await fetch(
    agentEndpoint(`/v1/websites/${websiteId}/sessions/${sessionId}/attachments/${attachmentId}`),
    { method: 'DELETE', credentials: 'include' },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
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
