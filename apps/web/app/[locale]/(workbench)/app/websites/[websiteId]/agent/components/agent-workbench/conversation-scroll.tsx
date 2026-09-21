import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const FOLLOW_THRESHOLD_PX = 96;

function isNearLatest(container: HTMLDivElement): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <= FOLLOW_THRESHOLD_PX
  );
}

function scrollToLatest(container: HTMLDivElement): void {
  container.scrollTop = container.scrollHeight;
}

export type ConversationScroll = {
  containerRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  showReturnToLatest: boolean;
  onScroll: () => void;
  onWheel: (deltaY: number) => void;
  onTouchStart: (clientY: number) => void;
  onTouchMove: (clientY: number) => void;
  onTouchEnd: () => void;
  returnToLatest: () => void;
};

export function useConversationScroll(
  contentVersion: string,
  followKey?: string,
): ConversationScroll {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const shouldFollowRef = useRef(true);
  const userPausedRef = useRef(false);
  const pauseScrollObservedRef = useRef(false);
  const touchYRef = useRef<number | null>(null);
  const previousFollowKeyRef = useRef(followKey);
  const previousScrollTopRef = useRef(0);
  const hasObservedScrollRef = useRef(false);
  const [showReturnToLatest, setShowReturnToLatest] = useState(false);

  const isNearLatestCallback = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    return isNearLatest(container);
  }, []);

  const scheduleScrollToLatest = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const container = containerRef.current;
      if (container && shouldFollowRef.current) {
        scrollToLatest(container);
        previousScrollTopRef.current = container.scrollTop;
        hasObservedScrollRef.current = true;
      }
    });
  }, []);

  const returnToLatest = useCallback(() => {
    shouldFollowRef.current = true;
    setShowReturnToLatest(false);
    scheduleScrollToLatest();
  }, [scheduleScrollToLatest]);

  const onScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!hasObservedScrollRef.current) {
      previousScrollTopRef.current = container.scrollTop;
      hasObservedScrollRef.current = true;
    }
    const movedUp = container.scrollTop < previousScrollTopRef.current;
    const movedDown = container.scrollTop > previousScrollTopRef.current;
    previousScrollTopRef.current = container.scrollTop;
    const nearLatest = isNearLatestCallback();
    if (userPausedRef.current) {
      if (!pauseScrollObservedRef.current) {
        pauseScrollObservedRef.current = true;
        setShowReturnToLatest(true);
        return;
      }
      if (!nearLatest || !movedDown) {
        setShowReturnToLatest(true);
        return;
      }
      userPausedRef.current = false;
      shouldFollowRef.current = true;
      setShowReturnToLatest(false);
      return;
    }
    if (movedUp) {
      shouldFollowRef.current = false;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setShowReturnToLatest(true);
      return;
    }
    shouldFollowRef.current = nearLatest;
    setShowReturnToLatest((current) => (current === !nearLatest ? current : !nearLatest));
  }, [isNearLatestCallback]);

  const onWheel = useCallback((deltaY: number) => {
    if (deltaY < 0) {
      userPausedRef.current = true;
      pauseScrollObservedRef.current = false;
      shouldFollowRef.current = false;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setShowReturnToLatest(true);
    }
  }, []);

  const onTouchStart = useCallback((clientY: number) => {
    touchYRef.current = clientY;
  }, []);

  const onTouchMove = useCallback(
    (clientY: number) => {
      const previousY = touchYRef.current;
      touchYRef.current = clientY;
      if (previousY === null) return;
      const deltaY = clientY - previousY;
      if (deltaY > 0) {
        onWheel(-1);
      }
    },
    [onWheel],
  );

  const onTouchEnd = useCallback(() => {
    touchYRef.current = null;
  }, []);

  useEffect(() => {
    if (followKey !== previousFollowKeyRef.current) {
      previousFollowKeyRef.current = followKey;
      userPausedRef.current = false;
      pauseScrollObservedRef.current = false;
      shouldFollowRef.current = true;
      previousScrollTopRef.current = containerRef.current?.scrollTop ?? 0;
      hasObservedScrollRef.current = true;
      setShowReturnToLatest(false);
    }
    if (shouldFollowRef.current) scheduleScrollToLatest();
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [contentVersion, followKey, scheduleScrollToLatest]);

  useEffect(() => {
    const container = containerRef.current;
    const content = container?.firstElementChild;
    if (!container || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (shouldFollowRef.current) scheduleScrollToLatest();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scheduleScrollToLatest]);

  return {
    containerRef,
    endRef,
    showReturnToLatest,
    onScroll,
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    returnToLatest,
  };
}
