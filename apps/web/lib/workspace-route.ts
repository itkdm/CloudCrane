export type WorkspaceRouteState = {
  view?: 'websites' | 'templates';
  websiteId?: string | null;
  sessionId?: string | null;
};

/** Build the shareable URL for the current workspace state. */
export function buildWorkspacePath(locale: string, state: WorkspaceRouteState): string {
  const basePath = `/${locale}/app/websites`;
  if (state.view === 'templates') return `${basePath}?view=templates`;
  if (state.websiteId) {
    const websitePath = `${basePath}/${encodeURIComponent(state.websiteId)}/sessions`;
    if (state.sessionId) return `${websitePath}/${encodeURIComponent(state.sessionId)}`;
    return websitePath;
  }
  return basePath;
}
