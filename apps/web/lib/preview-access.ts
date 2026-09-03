import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreviewUrl } from './agent-client';

export type PreviewAccess = {
  url: string;
  expiresAt: number;
};

type CachedPreviewAccess = PreviewAccess & {
  issuedAt: number;
  renewAt: number;
};

type WebsiteAccess = {
  websiteId: string;
  access: CachedPreviewAccess;
};

export function calculatePreviewRenewAt(expiresAt: number, now = Date.now()): number {
  const remaining = expiresAt * 1000 - now;
  const lead = Math.min(60_000, Math.max(5_000, remaining * 0.1));
  return expiresAt * 1000 - lead;
}

export function isPreviewAccessFresh(
  access: PreviewAccess | undefined,
  now = Date.now(),
  issuedAt = now,
): boolean {
  return Boolean(access && now < calculatePreviewRenewAt(access.expiresAt, issuedAt));
}

export async function authorizePreviewAccess(access: PreviewAccess): Promise<void> {
  await fetch(access.url, {
    cache: 'no-store',
    credentials: 'include',
    mode: 'no-cors',
    redirect: 'follow',
  });
}

export function usePreviewAccess(
  websiteId: string,
  options: {
    enabled: boolean;
    onAccess?: (access: PreviewAccess) => void;
    onError?: (cause: unknown) => void;
  },
) {
  const { enabled, onAccess, onError } = options;
  const [access, setAccess] = useState<CachedPreviewAccess>();
  const websiteIdRef = useRef(websiteId);
  const accessRef = useRef<WebsiteAccess | undefined>(undefined);
  const inFlightRef = useRef<Promise<PreviewAccess> | null>(null);
  const inFlightWebsiteIdRef = useRef<string | undefined>(undefined);
  const renewalTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    websiteIdRef.current = websiteId;
  }, [websiteId]);

  const clearRenewalTimer = useCallback(() => {
    if (renewalTimerRef.current) {
      clearTimeout(renewalTimerRef.current);
      renewalTimerRef.current = undefined;
    }
  }, []);

  const ensureFreshPreviewAccess = useCallback(
    async ({ force = false }: { force?: boolean } = {}): Promise<PreviewAccess> => {
      const current = accessRef.current;
      if (
        !force &&
        current?.websiteId === websiteId &&
        isPreviewAccessFresh(current.access, Date.now(), current.access.issuedAt)
      ) {
        return current.access;
      }
      if (inFlightRef.current && inFlightWebsiteIdRef.current === websiteId) {
        return inFlightRef.current;
      }

      const requestWebsiteId = websiteId;
      const request = getPreviewUrl(requestWebsiteId)
        .then((nextAccess) => {
          if (websiteIdRef.current === requestWebsiteId) {
            const cachedAccess = {
              ...nextAccess,
              issuedAt: Date.now(),
              renewAt: calculatePreviewRenewAt(nextAccess.expiresAt),
            };
            accessRef.current = { websiteId: requestWebsiteId, access: cachedAccess };
            setAccess(cachedAccess);
            onAccess?.(nextAccess);
          }
          return nextAccess;
        })
        .catch((cause) => {
          if (websiteIdRef.current === requestWebsiteId) onError?.(cause);
          throw cause;
        })
        .finally(() => {
          if (inFlightRef.current === request) {
            inFlightRef.current = null;
            inFlightWebsiteIdRef.current = undefined;
          }
        });
      inFlightRef.current = request;
      inFlightWebsiteIdRef.current = requestWebsiteId;
      return request;
    },
    [onAccess, onError, websiteId],
  );

  const renewPreviewAccess = useCallback(async () => {
    try {
      const nextAccess = await ensureFreshPreviewAccess({ force: true });
      await authorizePreviewAccess(nextAccess);
    } catch {
      // The next explicit preview operation remains the recovery path.
    }
  }, [ensureFreshPreviewAccess]);

  useEffect(() => {
    clearRenewalTimer();
    accessRef.current = undefined;
  }, [clearRenewalTimer, websiteId]);

  useEffect(() => {
    clearRenewalTimer();
    if (!enabled || !access || accessRef.current?.websiteId !== websiteId) return;
    const delay = access.renewAt - Date.now();
    if (delay <= 0) {
      void renewPreviewAccess();
      return;
    }
    renewalTimerRef.current = setTimeout(() => {
      renewalTimerRef.current = undefined;
      void renewPreviewAccess();
    }, delay);
    return clearRenewalTimer;
  }, [access, clearRenewalTimer, enabled, renewPreviewAccess, websiteId]);

  useEffect(() => clearRenewalTimer, [clearRenewalTimer]);

  return { access, ensureFreshPreviewAccess, clearRenewalTimer };
}
