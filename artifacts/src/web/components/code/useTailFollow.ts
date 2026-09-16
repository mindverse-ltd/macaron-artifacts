"use client";
import { useEffect, useRef, useState } from "react";
import { stepTailSpring } from "./tail-spring";

/**
 * 两条边各自「外面还藏了多少」，`0`～`1`，离边超过 `range` 像素就饱和。
 *
 * 给连续量而不是布尔：调用方拿它同时驱动蒙版宽度、模糊半径和透明度，滚到边缘附近时渐隐带是
 * 化开的，而不是「有」和「没有」之间闪一下。量化到 1/50 —— 滚动时这个值每帧都在变，
 * 不吸附一下就是每帧一次 React 渲染。
 */
function scrollEdges(element: HTMLElement, range: number) {
  const gap = element.scrollHeight - element.clientHeight;
  const ratio = (value: number) => Math.round(Math.min(1, Math.max(0, value / range)) * 50) / 50;
  return { start: ratio(element.scrollTop), end: ratio(gap - element.scrollTop) };
}

/**
 * 限高窗口跟着内容尾部走：新的一行永远贴在底边。
 *
 * 用弹簧而不是 `scroll-behavior: smooth`：流式每帧都在改目标，smooth 每次赋值都重启一段动画，
 * 叠起来是一顿一顿的；弹簧只有一个持续积分的状态，目标变了也不会打断，看着是一条连续的位移。
 */
export function useTailFollow(ref: React.RefObject<HTMLElement | null>, height: number, range: number, streaming?: boolean) {
  const [edges, setEdges] = useState({ top: 0, bottom: 0 });
  const following = useRef(false);
  const hasFollowed = useRef(false);
  const paused = useRef(false);
  /** 上次量到的内容高度。`0` = 还没量过 —— 内容一次到位（刷新、翻历史消息）不算「长出来」，那种该停在开头。 */
  const seen = useRef(0);
  /** 自己维护浮点位置：`scrollTop` 读回来会被取整，拿它当积分状态会在低速段卡住。 */
  const position = useRef(0);
  const velocity = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let previousScrollTop = element.scrollTop;
    const measure = () => {
      // Once all content fits again there is no hidden history to protect from future growth.
      if (element.scrollHeight <= element.clientHeight) paused.current = false;
      const { start: top, end: trailing } = scrollEdges(element, range);
      // Mask actual overflow, including content the spring has not reached yet; arrival naturally clears it.
      const bottom = trailing;
      setEdges((previous) => (previous.top === top && previous.bottom === bottom ? previous : { top, bottom }));
    };
    // 用户一动手就脱离跟随。scroll 事件分不出是谁滚的（弹簧自己也在写 scrollTop），
    // wheel / touch / 按键才是人的意图
    const release = () => {
      previousScrollTop = element.scrollTop;
      paused.current = element.scrollHeight > element.clientHeight;
      following.current = false;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      velocity.current = 0;
    };
    const onScroll = () => {
      // The first upward frame can still round to the bottom. Resume only when moving back down to it.
      if (element.scrollTop > previousScrollTop && !scrollEdges(element, range).end && element.scrollHeight > element.clientHeight) { paused.current = false; following.current = hasFollowed.current; }
      previousScrollTop = element.scrollTop;
      measure();
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    // Async highlighting can change static source height without scrolling. Resize updates its masks only;
    // being at the bottom must not turn history into a live follower.
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    if (element.firstElementChild) resize.observe(element.firstElementChild);
    element.addEventListener("wheel", release, { passive: true });
    element.addEventListener("touchstart", release, { passive: true });
    element.addEventListener("keydown", release);
    measure();
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", release);
      element.removeEventListener("touchstart", release);
      element.removeEventListener("keydown", release);
      resize.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [ref, range]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const grew = height > seen.current && (seen.current > 0 || streaming === true);
    seen.current = height;
    // A final chunk can lay out after streaming ends. Let an existing follower settle, but never arm static history.
    if (!grew || (streaming === false && !following.current) || paused.current) return;
    following.current = true;
    hasFollowed.current = true;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    // Even reduced-motion jumps read geometry in the next frame, after the new content has laid out.
    // 已经在跑就不重启：目标是每帧现取的，长出来的新内容自然被追上 ——
    // 生成结束只是不再有新目标，弹簧停在原地，不会「弹回顶部」
    if (frame.current) return;
    position.current = element.scrollTop;
    let previousTime = performance.now();
    const step = (time: number) => {
      if (!following.current) return ((frame.current = 0), undefined);
      const target = Math.max(0, element.scrollHeight - element.clientHeight);
      if (reducedMotion.matches) { element.scrollTop = target; velocity.current = 0; frame.current = 0; return; }
      const distance = target - position.current;
      const next = stepTailSpring(position.current, velocity.current, target, time - previousTime);
      previousTime = time; position.current = next.position; velocity.current = next.velocity;
      if (Math.abs(distance) < 0.5 && Math.abs(velocity.current) < 2) {
        position.current = target;
        velocity.current = 0;
        element.scrollTop = target;
        frame.current = 0;
        return;
      }
      element.scrollTop = position.current;
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [height, ref, streaming]);

  return edges;
}
