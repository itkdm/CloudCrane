import { Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';

type WorkbenchHeaderProps = {
  connection: string;
};

export function WorkbenchHeader({ connection }: WorkbenchHeaderProps) {
  const t = useTranslations('workbench');
  const isConnected = connection === 'connected';
  const connectionLabel = t(
    connection in { connected: 1, connecting: 1, reconnecting: 1, unavailable: 1 }
      ? connection
      : 'abnormal',
  );

  return (
    <header className="workbench-header" aria-label={t('ariaLabel')}>
      <div className="workbench-brand">
        <Image
          src="/cloudcrane-logo.png?v=f9d843e"
          alt=""
          aria-hidden="true"
          width={24}
          height={24}
          unoptimized
        />
        <span className="brand-name">筑云鹤</span>
      </div>
      {!isConnected ? (
        <div
          className={`connection-status ${connection}`}
          role="status"
          aria-live="polite"
          aria-label={connectionLabel}
        >
          <Circle size={8} strokeWidth={0} fill="currentColor" aria-hidden="true" />
          {connectionLabel}
        </div>
      ) : null}
    </header>
  );
}
