import { UnifiedApp } from './unified-app';

function parseView(value: string | undefined) {
  return value === 'templates' || value === 'conversations' || value === 'websites'
    ? value
    : undefined;
}

export default async function WebsitesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; websiteId?: string; sessionId?: string }>;
}) {
  const params = await searchParams;
  return (
    <UnifiedApp
      initialState={{
        view: parseView(params.view),
        websiteId: params.websiteId ?? null,
        sessionId: params.sessionId ?? null,
      }}
    />
  );
}
