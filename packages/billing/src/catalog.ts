export const FREE_PREVIEW_PLAN_KEY = 'free-preview';
export const FREE_PREVIEW_PLAN_VERSION = 1;
export const FREE_PREVIEW_SOURCE_REF = `${FREE_PREVIEW_PLAN_KEY}:v${FREE_PREVIEW_PLAN_VERSION}`;

export const BILLING_FEATURES = {
  previewEnabled: 'preview.enabled',
  productionEnabled: 'production.enabled',
  productionWebsiteCount: 'production.website_count',
  storageAccountBytes: 'storage.account_bytes',
} as const;

export const FREE_PREVIEW_CATALOG = {
  plan: {
    key: FREE_PREVIEW_PLAN_KEY,
    name: 'Free Preview',
    description: '基础预览权益，不包含正式网站发布能力。',
    displayName: 'Free Preview',
    billingInterval: 'one_time' as const,
    intervalCount: 1,
    priceAmount: '0',
    priceCurrency: 'USD',
  },
  entitlements: [
    {
      key: BILLING_FEATURES.previewEnabled,
      name: 'Preview',
      valueType: 'boolean' as const,
      unit: undefined,
      value: { enabled: true },
    },
    {
      key: BILLING_FEATURES.productionEnabled,
      name: 'Production website',
      valueType: 'boolean' as const,
      unit: undefined,
      value: { enabled: false },
    },
    {
      key: BILLING_FEATURES.productionWebsiteCount,
      name: 'Production website count',
      valueType: 'metered' as const,
      unit: 'websites',
      value: { limit: 0, unit: 'websites', limitMode: 'hard' as const },
    },
    {
      key: BILLING_FEATURES.storageAccountBytes,
      name: 'Account attachment storage',
      valueType: 'metered' as const,
      unit: 'bytes',
      value: { limit: 50 * 1024 * 1024, unit: 'bytes', limitMode: 'hard' as const },
    },
  ],
} as const;
