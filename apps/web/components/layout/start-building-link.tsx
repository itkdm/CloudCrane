'use client';

import { LoaderCircle } from 'lucide-react';
import { useLinkStatus } from 'next/link';
import { useState } from 'react';
import { Link } from '../../i18n/navigation';

function NavigationStatus({
  navigating,
  pendingLabel,
}: {
  navigating: boolean;
  pendingLabel: string;
}) {
  const { pending } = useLinkStatus();
  const active = pending || navigating;

  return (
    <>
      <LoaderCircle
        className="marketing-button-loading"
        data-pending={active}
        size={16}
        aria-hidden="true"
      />
      {active ? <span className="sr-only">{pendingLabel}</span> : null}
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
  const [navigating, setNavigating] = useState(false);

  return (
    <Link
      className={className}
      href="/app/websites"
      aria-disabled={navigating}
      onClick={(event) => {
        if (navigating) {
          event.preventDefault();
          return;
        }
        setNavigating(true);
      }}
    >
      <span className="marketing-button-label">{children}</span>
      <NavigationStatus navigating={navigating} pendingLabel={pendingLabel} />
    </Link>
  );
}
