import { useTranslations } from 'next-intl';

export function Brand() {
  const t = useTranslations('common');
  return <span>{t('brand')}</span>;
}
