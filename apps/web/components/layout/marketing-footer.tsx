import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { Brand } from './brand';

export function MarketingFooter() {
  const t = useTranslations('marketing');
  const navigation = useTranslations('navigation');
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-copy">
        <Link className="cc-brand" href="/">
          <Brand />
        </Link>
        <p>{t('footerDescription')}</p>
      </div>
      <nav aria-label={navigation('product')}>
        <Link href="/">{navigation('product')}</Link>
        <Link href="/templates">{navigation('templates')}</Link>
        <Link href="/docs">{navigation('docs')}</Link>
      </nav>
      <small>{t('copyright')}</small>
    </footer>
  );
}
