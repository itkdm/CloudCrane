import { ResetPasswordForm } from '@/components/auth/account-recovery';
import { getTranslations } from 'next-intl/server';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (token) return <ResetPasswordForm token={token} />;
  const t = await getTranslations('auth');
  return <p>{t('invalidResetLink')}</p>;
}
