export async function disposeAgentRuntime(websiteId: string): Promise<void> {
  const endpoint =
    process.env.AGENT_SERVICE_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ??
    'http://127.0.0.1:4101';
  const token = process.env.AGENT_SERVICE_INTERNAL_TOKEN;
  if (!token) throw new Error('agent service internal token is not configured');
  const response = await fetch(
    `${endpoint.replace(/\/$/, '')}/v1/internal/websites/${websiteId}/runtime`,
    {
      method: 'DELETE',
      headers: { 'x-cloudcrane-internal-token': token },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    let message = `agent runtime disposal failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // Keep the status-only error when the internal service did not return JSON.
    }
    throw new Error(message);
  }
}

export async function finalizeAgentRuntime(websiteId: string): Promise<void> {
  const endpoint =
    process.env.AGENT_SERVICE_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ??
    'http://127.0.0.1:4101';
  const token = process.env.AGENT_SERVICE_INTERNAL_TOKEN;
  if (!token) return;
  await fetch(`${endpoint.replace(/\/$/, '')}/v1/internal/websites/${websiteId}/runtime/finalize`, {
    method: 'POST',
    headers: { 'x-cloudcrane-internal-token': token },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
