'use client';

import { LoaderCircle } from 'lucide-react';
import { useLinkStatus } from 'next/link';
import { Link } from '../../i18n/navigation';

function NavigationStatus({ pendingLabel }: { pendingLabel: string }) {
  const { pending } = useLinkStatus();

  return (
    <>
      <LoaderCircle
        className="marketing-button-loading"
        data-pending={pending}
        size={16}
        aria-hidden="true"
      />
      {pending ? <span className="sr-only">{pendingLabel}</span> : null}
    </>
  );
}

export function StartBuildingLink({
  className,
  children,
  pendingLabel,
}: {
  className: string;
  children: React.ReactNode;
  pendingLabel: string;
}) {
  return (
    <Link className={className} href="/app/websites">
      {children}
      <NavigationStatus pendingLabel={pendingLabel} />
    </Link>
  );
}
