import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'zh'],
  defaultLocale: 'en',
  // Keep the locale in every URL. This avoids the default-locale `/` rewrite
  // becoming an absolute internal URL behind the production reverse proxy.
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];
