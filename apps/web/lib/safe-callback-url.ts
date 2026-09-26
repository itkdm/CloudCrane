export function safeCallbackUrl(value: string | null, locale: string): string {
  const fallback = `/${locale}/app/websites`;
  if (!value || !value.startsWith('/')) return fallback;

  try {
    const base = new URL('https://cloudcrane.invalid');
    const target = new URL(value, base);
    if (target.origin !== base.origin) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
