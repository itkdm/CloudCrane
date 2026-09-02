export const WEBSITE_STATUSES = [
  'ready',
  'provisioning',
  'initializing',
  'initialization_failed',
  'authorization_required',
  'provisioning_failed',
] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export function isWebsiteStatus(value: string): value is WebsiteStatus {
  return WEBSITE_STATUSES.includes(value as WebsiteStatus);
}
