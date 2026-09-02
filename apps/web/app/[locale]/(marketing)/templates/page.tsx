import { useTranslations } from 'next-intl';
export default function TemplatesPage() {
  const t = useTranslations('app');
  return (
    <section className="cc-page-placeholder">
      <h1>{t('templatesEntry')}</h1>
      <p>{t('templatesDescription')}</p>
    </section>
  );
}
