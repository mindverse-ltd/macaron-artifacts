"use client";
import { useEffect, useRef, useState } from "react";
import { attachReasoningScroll } from "../chat/reasoning-scroll";

/** Share the chat/reasoning spring and input ownership. Content growth changes the destination, never the current velocity. */
export function useTailFollow(ref: React.RefObject<HTMLElement | null>, height: number, range: number, streaming?: boolean) {
  const [edges, setEdges] = useState({ top: 0, bottom: 0 });
  const controller = useRef<ReturnType<typeof attachReasoningScroll> | null>(null);
  const live = useRef(streaming === true);
  live.current = streaming === true;
  useEffect(() => {
    const element = ref.current, content = element?.firstElementChild;
    if (!element || !(content instanceof HTMLElement)) return;
    // Observe the actual source layout, including asynchronous syntax highlighting, rather than depending on React's measured-height render.
    const follow = attachReasoningScroll(element, content, live.current, () => {}, { followAfterCompletion: true, onMeasure(top, bottom) {
      const ratio = (value: number) => Math.round(Math.min(1, Math.max(0, value / range)) * 50) / 50;
      const next = { top: ratio(top), bottom: ratio(bottom) };
      setEdges(previous => previous.top === next.top && previous.bottom === next.bottom ? previous : next);
    } });
    controller.current = follow;
    return () => { follow.destroy(); controller.current = null; };
  }, [ref, range]);
  useEffect(() => { controller.current?.update(streaming === true); }, [height, streaming]);
  return edges;
}
