import { useLayoutEffect, useRef, useState } from 'react';

/** Reserve the open geometry in the same commit that closes native details, before the browser can clamp scrollTop. */
export function useReasoningCollapse(collapsed: boolean, automatic: boolean) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [openHeight, setOpenHeight] = useState(0);
  useLayoutEffect(() => {
    const element = disclosure.current;
    if (!element || collapsed) return;
    const measure = () => setOpenHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [collapsed]);
  useLayoutEffect(() => {
    const element = disclosure.current;
    if (!element || !collapsed || !automatic || !openHeight) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)'), target = element.querySelector('summary')?.getBoundingClientRect().height ?? 0;
    if (media.matches || openHeight <= target) { setOpenHeight(0); return; }
    // Only the one-shot disclosure handoff changes height. Streaming growth remains native and never restarts this transition.
    const animation = element.animate([{ minHeight: `${openHeight}px` }, { minHeight: `${target}px` }], { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    const finish = () => setOpenHeight(0);
    animation.addEventListener('finish', finish);
    const reduce = () => { if (media.matches) { animation.finish(); finish(); } }; media.addEventListener('change', reduce);
    return () => { animation.removeEventListener('finish', finish); animation.cancel(); media.removeEventListener('change', reduce); };
  }, [automatic, collapsed, openHeight]);
  return { disclosure, minHeight: collapsed && automatic && openHeight ? openHeight : undefined };
}
