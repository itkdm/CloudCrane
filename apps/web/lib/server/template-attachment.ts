import type { TemplateSnapshot } from './template-catalog.js';

export async function attachTemplateReference(input: {
  websiteId: string;
  workspaceId: string;
  template: Pick<TemplateSnapshot, 'id' | 'artifactStorageKey' | 'artifactSha256'>;
}): Promise<{ referenceId: string }> {
  const endpoint =
    process.env.AGENT_SERVICE_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ??
    'http://127.0.0.1:4101';
  const token = process.env.AGENT_SERVICE_INTERNAL_TOKEN;
  if (!token) throw new Error('agent service internal token is not configured');
  const response = await fetch(
    `${endpoint.replace(/\/$/, '')}/v1/internal/websites/${input.websiteId}/template-attachment`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cloudcrane-internal-token': token,
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        templateId: input.template.id,
        artifactStorageKey: input.template.artifactStorageKey,
        artifactSha256: input.template.artifactSha256,
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    let message = `template attachment failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // Keep the status-only error when the internal service did not return JSON.
    }
    throw new Error(message);
  }
  const result = (await response.json()) as { referenceId?: string };
  if (!result.referenceId) throw new Error('template attachment returned no reference id');
  return { referenceId: result.referenceId };
}
