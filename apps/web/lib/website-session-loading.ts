export type WebsiteSessionLoadable = {
  status?: string | null;
};

export function canEnterWorkspace<T extends WebsiteSessionLoadable>(
  website: T | undefined,
): website is T {
  return website?.status === 'ready';
}
