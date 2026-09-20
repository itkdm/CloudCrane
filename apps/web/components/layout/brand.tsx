import { useTranslations } from 'next-intl';
import Image from 'next/image';

export function Brand() {
  const t = useTranslations('common');
  return (
    <span className="cc-brand-content">
      <Image
        className="cc-brand-logo"
        src="/cloudcrane-logo.png?v=f9d843e"
        alt=""
        aria-hidden="true"
        width={28}
        height={28}
        unoptimized
      />
      <span>{t('brand')}</span>
    </span>
  );
}
