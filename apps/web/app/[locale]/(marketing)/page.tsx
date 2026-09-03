import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MarketingHero } from '../../../components/marketing/marketing-hero';
import '../../landing.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing' });
  return {
    title: `${t('title')} · CloudCrane`,
    description: t('lede'),
    alternates: { canonical: locale === 'zh' ? '/zh' : '/', languages: { en: '/', zh: '/zh' } },
    openGraph: {
      title: t('title'),
      description: t('lede'),
      locale: locale === 'zh' ? 'zh_CN' : 'en_US',
      type: 'website',
    },
  };
}

export default function Home() {
  return (
    <main className="landing">
      <MarketingHero />
    </main>
  );
}
