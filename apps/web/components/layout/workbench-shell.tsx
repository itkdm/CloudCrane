import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';

export function WorkbenchShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('navigation');
  return (
    <div className="workbench-layout">
      <div className="workbench-context">
        <Link href="/app/websites">← {t('backToWebsites')}</Link>
        <span aria-hidden="true">/</span>
        <span>{t('product')}</span>
      </div>
      {children}
    </div>
  );
}
