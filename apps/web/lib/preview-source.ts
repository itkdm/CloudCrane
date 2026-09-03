export function resolvePreviewSource(
  baseUrl: string | undefined,
  currentUrl?: string,
): string | undefined {
  if (!baseUrl) return undefined;
  if (!currentUrl) return baseUrl;
  try {
    return new URL(currentUrl).origin === new URL(baseUrl).origin ? currentUrl : baseUrl;
  } catch {
    return baseUrl;
  }
}
