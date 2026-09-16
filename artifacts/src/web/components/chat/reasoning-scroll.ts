import { bottomSpringSettled, createBottomSpring, stepBottomSpring, stepBottomSpringClock, type BottomSpring } from './bottom-spring';

type ScrollViewport = Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>;
export type ReasoningScrollStatus = { following: boolean; overflowing: boolean };
const EDGE_RAMP = 24, BOTTOM_TOLERANCE = 2;
export const reasoningScrollTop = (element: ScrollViewport) => Math.min(Math.max(0, element.scrollHeight - element.clientHeight), Math.max(0, element.scrollTop));

/** Own only the DOM animation; React is notified when a visible control actually changes. */
export function attachReasoningScroll(element: HTMLElement, content: HTMLElement, initialLive: boolean, onStatus: (status: ReasoningScrollStatus) => void) {
  const page = element.ownerDocument;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const wall = () => Math.max(0, element.scrollHeight - element.clientHeight);
  const bouncing = () => element.scrollTop < 0 || element.scrollTop > wall();
  let live = initialLive, following = true, overflowing = false, forced = false;
  let frame = 0, lastTime = 0, startup = 0, userScrollUntil = 0, touchY = 0;
  let lastTop = reasoningScrollTop(element), lastWrittenTop = lastTop, lastHeight = element.scrollHeight, wasBouncing = bouncing();
  let spring: BottomSpring | null = null;
  let reported: ReasoningScrollStatus = { following, overflowing };
  const report = () => {
    if (following === reported.following && overflowing === reported.overflowing) return;
    onStatus(reported = { following, overflowing });
  };
  const stop = () => { spring = null; startup = 0; };
  const writeTop = (top: number) => {
    if (element.scrollTop !== top) element.scrollTop = top;
    lastTop = lastWrittenTop = reasoningScrollTop(element);
  };
  const measure = (time: number) => {
    frame = 0;
    const target = wall(), rawTop = element.scrollTop;
    let moving = false;
    if ((live && following || forced) && !bouncing()) {
      if (reducedMotion.matches) { writeTop(target); stop(); forced = false; }
      else {
        // Native downward advances use DOM readbacks; rounding must never pull the solver backward.
        if (spring && rawTop > lastWrittenTop) spring = { ...spring, position: rawTop };
        const clock = stepBottomSpringClock(startup, time - lastTime); startup = clock.elapsed;
        spring = stepBottomSpring(spring ?? createBottomSpring(rawTop, target), target, clock.delta);
        if (bottomSpringSettled(spring)) { writeTop(target); stop(); forced = false; }
        else { writeTop(spring.position); moving = true; }
      }
    } else stop();
    lastTime = time;
    const top = reasoningScrollTop(element), bottom = target - top;
    // A growing gap is animation lag, not reading intent. Finished/history content never auto-follows.
    if (!live && !forced && bottom > BOTTOM_TOLERANCE) following = false;
    overflowing = target > BOTTOM_TOLERANCE;
    lastTop = top; lastHeight = element.scrollHeight;
    element.style.setProperty('--reasoning-fade-top', String(Math.min(1, top / EDGE_RAMP)));
    element.style.setProperty('--reasoning-fade-bottom', String(Math.min(1, bottom / EDGE_RAMP)));
    report();
    if (moving) frame = requestAnimationFrame(measure);
  };
  const wake = () => { if (!frame && !page.hidden) { lastTime = performance.now(); frame = requestAnimationFrame(measure); } };
  // Suspend elapsed time, not momentum: returning to the tab must not integrate the entire hidden interval.
  const onVisibility = () => { cancelAnimationFrame(frame); frame = 0; wake(); };
  const pause = () => { following = false; forced = false; stop(); report(); wake(); };
  const resume = (instant = false) => {
    following = true; forced = true; stop(); userScrollUntil = 0;
    // Only an explicit command may take ownership of Safari's elastic offset.
    if (instant || reducedMotion.matches) { writeTop(wall()); forced = false; }
    else if (bouncing()) writeTop(reasoningScrollTop(element));
    report(); wake();
  };
  const noteUserScroll = () => { userScrollUntil = performance.now() + 1200; };
  const onScroll = () => {
    const top = reasoningScrollTop(element), isBouncing = bouncing(), shrank = element.scrollHeight < lastHeight;
    if (!isBouncing && !wasBouncing) {
      if (!shrank && top < lastTop - 0.5) pause();
      else if (!following && top > lastTop + 0.5 && performance.now() < userScrollUntil && wall() - top <= BOTTOM_TOLERANCE) { following = true; report(); }
    }
    wasBouncing = isBouncing; lastTop = top; lastHeight = element.scrollHeight; wake();
  };
  const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) { userScrollUntil = 0; pause(); } else if (event.deltaY > 0) noteUserScroll(); };
  const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY ?? touchY;
    if (y > touchY + 2) { userScrollUntil = 0; pause(); } else if (y < touchY) noteUserScroll();
    touchY = y;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[role="combobox"]')) return;
    if (event.key === 'End') { event.preventDefault(); resume(true); }
    else if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || event.key === ' ' && event.shiftKey) { userScrollUntil = 0; pause(); }
    else if (['ArrowDown', 'PageDown', ' '].includes(event.key)) { noteUserScroll(); pause(); }
  };
  const observer = new ResizeObserver(wake);
  observer.observe(element); observer.observe(content);
  element.addEventListener('scroll', onScroll, { passive: true }); element.addEventListener('wheel', onWheel, { passive: true });
  element.addEventListener('touchstart', onTouchStart, { passive: true }); element.addEventListener('touchmove', onTouchMove, { passive: true });
  element.addEventListener('keydown', onKeyDown); content.addEventListener('load', wake, true); reducedMotion.addEventListener('change', wake);
  page.addEventListener('visibilitychange', onVisibility);
  wake();
  return {
    resume,
    update(nextLive: boolean) {
      // Ending or opening history interrupts immediately, even while the spring still trails the final line.
      if (live && !nextLive) { forced = false; stop(); }
      live = nextLive; wake();
    },
    destroy() {
      observer.disconnect(); cancelAnimationFrame(frame);
      element.removeEventListener('scroll', onScroll); element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart); element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('keydown', onKeyDown); content.removeEventListener('load', wake, true); reducedMotion.removeEventListener('change', wake);
      page.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
