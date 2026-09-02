import { UnifiedApp } from './unified-app';

function parseView(value: string | undefined): 'websites' | 'templates' | undefined {
  if (value === 'templates') return 'templates';
  // Legacy conversation URLs now open the selected website directly.
  if (value === 'conversations' || value === 'websites') return 'websites';
  return undefined;
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
