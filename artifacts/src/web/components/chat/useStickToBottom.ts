"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BOTTOM_SCROLL_SLACK, bottomScrollTarget, bottomSpringSettled, createBottomSpring, stepBottomSpring, type BottomSpring } from "./bottom-spring";

type Options = { enabled?: boolean; resetKey?: string | number | null; slack?: number; initial?: 'start' | 'end' };
export const PAUSE_BOTTOM_FOLLOW = 'ui4a:pause-bottom-follow';
let keyboardSubscribers = 0, keyboardFocusUntil = 0;
const noteKeyboardFocus = (event: KeyboardEvent) => { if (event.key === 'Tab') keyboardFocusUntil = performance.now() + 500; };

/** A continuous spring follows streamed layout growth; explicit reading actions release it immediately. */
export function useStickToBottom<V extends HTMLElement, C extends HTMLElement>({ enabled = true, resetKey, slack = BOTTOM_SCROLL_SLACK, initial = 'end' }: Options = {}) {
  const viewport = useRef<V>(null), content = useRef<C>(null);
  const [stuck, setStuck] = useState(true);
  const stuckRef = useRef(true), enabledRef = useRef(enabled);
  const controls = useRef<{ scroll: (behavior: ScrollBehavior) => void; syncEnabled: () => void } | null>(null);
  const setStuckBoth = useCallback((next: boolean) => { if (stuckRef.current === next) return; stuckRef.current = next; setStuck(next); }, []);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    setStuckBoth(true);
    controls.current?.scroll(behavior);
  }, [setStuckBoth]);
  // Streaming can end before the final module finishes layout. Keep an existing follow latch; never rearm a reader's pause here.
  useLayoutEffect(() => { enabledRef.current = enabled; controls.current?.syncEnabled(); }, [enabled]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const box = content.current ?? element;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const readWall = () => Math.max(0, element.scrollHeight - element.clientHeight);
    const readTop = () => Math.min(readWall(), Math.max(0, element.scrollTop));
    const bouncing = () => element.scrollTop < 0 || element.scrollTop > readWall();
    let lastTop = readTop(), lastTime = 0, frame = 0, userScrollUntil = 0, touchY = 0, pointerScrolling = false;
    let lastWrittenTop = lastTop;
    let followReady = enabledRef.current;
    let spring: BottomSpring | null = null;
    const writeTop = (position: number, wall: number) => {
      lastTop = Math.min(wall, Math.max(0, position));
      element.scrollTop = lastTop;
      lastTop = lastWrittenTop = element.scrollTop;
    };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; spring = null; };
    const release = () => { setStuckBoth(false); stop(); };
    const pauseReading = () => { userScrollUntil = 0; release(); };
    const tick = (time: number) => {
      frame = 0;
      if (!stuckRef.current || !followReady) return;
      // Safari's elastic offsets belong to its native gesture. A write here would cancel that motion.
      const wall = readWall(), top = element.scrollTop, target = bottomScrollTarget(wall, slack);
      if (top < 0 || top > wall) { spring = null; return; }
      if (reducedMotion.matches) { spring = createBottomSpring(target, wall, slack); writeTop(target, wall); return; }
      // Compare DOM readbacks, not the fractional spring, so even tiny native advances are kept without feeding rounding back into the solver.
      if (spring && top > lastWrittenTop) spring = { ...spring, position: Math.min(top, target) };
      spring = stepBottomSpring(spring ?? createBottomSpring(top, wall, slack), wall, time - lastTime, slack);
      lastTime = time;
      if (bottomSpringSettled(spring)) { spring = createBottomSpring(target, wall, slack); writeTop(target, wall); return; }
      writeTop(spring.position, wall);
      frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!stuckRef.current || !followReady || frame || bouncing()) return;
      spring ??= createBottomSpring(readTop(), readWall(), slack);
      lastTime = performance.now(); frame = requestAnimationFrame(tick);
    };
    const scroll = (behavior: ScrollBehavior) => {
      followReady = true;
      if (behavior === 'instant' || reducedMotion.matches) {
        cancelAnimationFrame(frame); frame = 0;
        const wall = readWall(), target = bottomScrollTarget(wall, slack);
        spring = createBottomSpring(target, wall, slack); writeTop(target, wall);
      } else wake();
    };
    controls.current = { scroll, syncEnabled: () => { followReady ||= enabledRef.current; wake(); } };
    const onScroll = () => {
      if (stuckRef.current) { lastTop = element.scrollTop; wake(); return; }
      const wall = readWall(), top = Math.min(wall, Math.max(0, element.scrollTop)), movedDown = top > lastTop + 1;
      lastTop = top;
      if (bouncing()) return;
      // Layout clamps and lag behind a growing target are not user intent.
      // Distance only helps a deliberate downward gesture resume following; it can never cancel an active latch.
      if (!stuckRef.current && !pointerScrolling && movedDown && performance.now() < userScrollUntil && bottomScrollTarget(wall, slack) - top <= 48) {
        followReady = true; spring = createBottomSpring(top, wall, slack); setStuckBoth(true);
      }
      if (stuckRef.current) wake();
    };
    const noteUserScroll = () => { userScrollUntil = performance.now() + 1200; };
    const onWheel = (event: WheelEvent) => { if (event.deltaY > 0) noteUserScroll(); if (event.deltaY < 0 && element.scrollTop > 0) pauseReading(); };
    const approvalDecision = (event: Event) => event.target instanceof Element && Boolean(event.target.closest('[data-approval-decision]'));
    const readingControl = (event: Event) => event.target instanceof Element && Boolean(event.target.closest('button,a,input,textarea,select,[contenteditable],[tabindex]:not([tabindex="-1"]),[role="button"],[role="tab"],[role="slider"],[role="combobox"]'));
    // Ordinary clicks and focus restoration should not silently disable following. Real control/selection gestures do.
    const onPointer = (event: PointerEvent) => {
      pointerScrolling = false;
      if (approvalDecision(event)) return;
      if (readingControl(event)) pauseReading();
      else if (event.target === element && event.clientX >= element.getBoundingClientRect().right - 16) { pointerScrolling = true; noteUserScroll(); release(); }
    };
    const pauseSelection = () => { const selection = document.getSelection(); if (selection && !selection.isCollapsed) pauseReading(); };
    const onPointerMove = (event: PointerEvent) => { if (event.buttons & 1) { if (pointerScrolling) noteUserScroll(); pauseSelection(); } };
    // The thumb can visit the tail and reverse before release; keep native dragging in charge for the entire gesture.
    const finishScrollbar = () => {
      if (!pointerScrolling) return;
      pointerScrolling = false; userScrollUntil = 0;
      if (!bouncing() && readWall() - readTop() <= 1) { setStuckBoth(true); scroll('smooth'); }
    };
    const cancelScrollbar = () => { if (pointerScrolling) { pointerScrolling = false; userScrollUntil = 0; } };
    const onPointerUp = () => { finishScrollbar(); pauseSelection(); };
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
    const onTouchMove = (event: TouchEvent) => { const y = event.touches[0]?.clientY ?? touchY; if (y < touchY) noteUserScroll(); if (y > touchY + 2) pauseReading(); touchY = y; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (approvalDecision(event)) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[role="combobox"]')) return;
      if (event.key === 'End') { event.preventDefault(); setStuckBoth(true); scroll('instant'); }
      else if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || event.key === ' ' && event.shiftKey) pauseReading();
      else if (['ArrowDown', 'PageDown', ' '].includes(event.key)) { noteUserScroll(); release(); }
    };
    const onInspect = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target instanceof Element && event.target.closest('[data-chat-expander]')) pauseReading();
    };
    const onFocus = (event: FocusEvent) => {
      if (approvalDecision(event)) return;
      // A focused code region or accessible chart is also a reading destination, even without a button/input role.
      if (performance.now() < keyboardFocusUntil) pauseReading();
    };
    if (keyboardSubscribers++ === 0) document.addEventListener('keydown', noteKeyboardFocus, true);
    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('wheel', onWheel, { passive: true });
    element.addEventListener('touchstart', onTouchStart, { passive: true }); element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('pointerdown', onPointer, true);
    element.addEventListener('pointermove', onPointerMove, { passive: true }); element.addEventListener('pointerup', onPointerUp, { passive: true }); element.addEventListener('dblclick', pauseSelection);
    document.addEventListener('pointerup', finishScrollbar); document.addEventListener('pointercancel', cancelScrollbar);
    element.addEventListener(PAUSE_BOTTOM_FOLLOW, pauseReading);
    element.addEventListener('keydown', onKeyDown);
    box.addEventListener('click', onInspect, true); box.addEventListener('keydown', onInspect, true);
    box.addEventListener('focusin', onFocus);
    box.addEventListener('load', wake, true);
    reducedMotion.addEventListener('change', wake);
    // ResizeObserver catches line wraps, inline UI mounts and viewport changes; rAF reads the live target every frame.
    const observer = new ResizeObserver(wake);
    observer.observe(box); observer.observe(element);
    // Canvas keeps its original h-full app shell: DOM growth can change scrollHeight without resizing that fixed box.
    const mutations = box === element ? new MutationObserver(wake) : null;
    mutations?.observe(box, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    setStuckBoth(true);
    const initialWall = readWall(); writeTop(initial === 'end' ? bottomScrollTarget(initialWall, slack) : 0, initialWall);
    wake();
    return () => {
      stop(); controls.current = null;
      element.removeEventListener('scroll', onScroll); element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart); element.removeEventListener('touchmove', onTouchMove); element.removeEventListener('pointerdown', onPointer, true); element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('pointermove', onPointerMove); element.removeEventListener('pointerup', onPointerUp); element.removeEventListener('dblclick', pauseSelection); element.removeEventListener(PAUSE_BOTTOM_FOLLOW, pauseReading);
      document.removeEventListener('pointerup', finishScrollbar); document.removeEventListener('pointercancel', cancelScrollbar);
      if (--keyboardSubscribers === 0) { document.removeEventListener('keydown', noteKeyboardFocus, true); keyboardFocusUntil = 0; }
      box.removeEventListener('click', onInspect, true); box.removeEventListener('keydown', onInspect, true);
      box.removeEventListener('focusin', onFocus); box.removeEventListener('load', wake, true);
      reducedMotion.removeEventListener('change', wake); observer.disconnect(); mutations?.disconnect();
    };
  }, [setStuckBoth, resetKey, slack, initial]);

  return { viewport, content, stuck, scrollToBottom };
}
