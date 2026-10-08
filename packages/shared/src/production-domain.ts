const reservedProductionSlugs = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'blog',
  'cdn',
  'console',
  'dashboard',
  'docs',
  'example',
  'ftp',
  'help',
  'invalid',
  'localhost',
  'login',
  'logout',
  'mail',
  'metrics',
  'monitor',
  'ns1',
  'ns2',
  'preview',
  'root',
  'security',
  'site',
  'smtp',
  'ssh',
  'status',
  'support',
  'system',
  'test',
  'www',
]);

const productionSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type ProductionSlugValidation =
  { valid: true; slug: string } | { valid: false; reason: 'format' | 'reserved' };

export function normalizeProductionSlug(value: string): ProductionSlugValidation {
  const slug = value.trim().toLowerCase();
  if (!productionSlugPattern.test(slug)) return { valid: false, reason: 'format' };
  if (reservedProductionSlugs.has(slug)) return { valid: false, reason: 'reserved' };
  return { valid: true, slug };
}

export function isProductionSlug(value: string): boolean {
  return normalizeProductionSlug(value).valid;
}

export function suggestProductionSlug(value: string, fallbackSuffix?: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  const candidate = normalized || `my-website${fallbackSuffix ? `-${fallbackSuffix}` : ''}`;
  return isProductionSlug(candidate) ? candidate : 'my-website';
}
