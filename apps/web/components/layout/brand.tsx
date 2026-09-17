import { useTranslations } from 'next-intl';
import Image from 'next/image';

export function Brand() {
  const t = useTranslations('common');
  return (
    <span className="cc-brand-content">
      <Image
        className="cc-brand-logo"
        src="/cloudcrane-logo.png"
        alt=""
        aria-hidden="true"
        width={20}
        height={20}
      />
      <span>{t('brand')}</span>
    </span>
  );
}
