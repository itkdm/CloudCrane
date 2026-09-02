'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '../../i18n/navigation';

export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const nextLocale = locale === 'en' ? 'zh' : 'en';
  return (
    <button
      className="cc-language-switcher"
      type="button"
      onClick={() => router.replace(pathname, { locale: nextLocale })}
    >
      {locale === 'en' ? '简体中文' : 'English'}
    </button>
  );
}
