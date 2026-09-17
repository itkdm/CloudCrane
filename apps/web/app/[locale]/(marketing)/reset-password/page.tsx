import { ResetPasswordForm } from '@/components/auth/account-recovery';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return token ? <ResetPasswordForm token={token} /> : <p>重置链接无效。</p>;
}
