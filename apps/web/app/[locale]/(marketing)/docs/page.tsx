import { useTranslations } from 'next-intl';
export default function DocsPage() {
  const t = useTranslations('navigation');
  return (
    <section className="cc-page-placeholder">
      <h1>{t('docs')}</h1>
    </section>
  );
}
