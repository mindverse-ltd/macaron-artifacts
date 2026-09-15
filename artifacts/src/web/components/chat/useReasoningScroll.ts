'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { attachReasoningScroll, type ReasoningScrollStatus } from './reasoning-scroll';

export function useReasoningScroll(contentKey: string, live: boolean) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ReasoningScrollStatus>({ following: true, overflowing: false });
  const liveRef = useRef(live), controller = useRef<ReturnType<typeof attachReasoningScroll> | null>(null);
  const resume = useCallback(() => controller.current?.resume(), []);

  useEffect(() => {
    if (!viewport.current || !content.current) return;
    controller.current = attachReasoningScroll(viewport.current, content.current, liveRef.current, setStatus);
    return () => { controller.current?.destroy(); controller.current = null; };
  }, []);

  // Commit the live flag before the next animation frame can scroll finished or opened history content.
  useLayoutEffect(() => { liveRef.current = live; if (contentKey || !live) controller.current?.update(live); }, [contentKey, live]);
  return { viewport, content, ...status, resume };
}
