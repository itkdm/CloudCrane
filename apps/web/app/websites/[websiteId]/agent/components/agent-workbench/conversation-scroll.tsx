import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const FOLLOW_THRESHOLD_PX = 96;

export type ConversationScroll = {
  containerRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  showReturnToLatest: boolean;
  onScroll: () => void;
  returnToLatest: () => void;
};

export function useConversationScroll(
  contentVersion: number,
  followKey?: string,
): ConversationScroll {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const shouldFollowRef = useRef(true);
  const [showReturnToLatest, setShowReturnToLatest] = useState(false);

  const isNearLatest = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight <= FOLLOW_THRESHOLD_PX
    );
  }, []);

  const scheduleScrollToLatest = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
  }, []);

  const returnToLatest = useCallback(() => {
    shouldFollowRef.current = true;
    setShowReturnToLatest(false);
    scheduleScrollToLatest();
  }, [scheduleScrollToLatest]);

  const onScroll = useCallback(() => {
    const nearLatest = isNearLatest();
    shouldFollowRef.current = nearLatest;
    setShowReturnToLatest(!nearLatest);
  }, [isNearLatest]);

  useEffect(() => {
    if (followKey) shouldFollowRef.current = true;
    if (shouldFollowRef.current) scheduleScrollToLatest();
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [contentVersion, followKey, scheduleScrollToLatest]);

  return { containerRef, endRef, showReturnToLatest, onScroll, returnToLatest };
}
