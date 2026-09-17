import { afterEach, beforeEach, expect, test } from 'bun:test';
import { attachReasoningScroll, reasoningScrollTop, type ReasoningScrollStatus } from './reasoning-scroll';

let now = 0, nextFrame = 0, page: EventTarget & { hidden: boolean };
const frames = new Map<number, FrameRequestCallback>(), observers = new Set<() => void>(), pendingScroll = new Set<FakeViewport>();
class FakeElement extends EventTarget { closest() { return null; } }
class FakeViewport extends FakeElement {
  get ownerDocument() { return page; }
  private top = 0;
  private height: number;
  writes: number[] = [];
  styles = new Map<string, string>();
  style = { setProperty: (name: string, value: string) => this.styles.set(name, value) };
  constructor(public clientHeight = 200, height = 1000, private quantized = false) { super(); this.height = height; }
  get scrollHeight() { return this.height; }
  set scrollHeight(value: number) {
    const wasLegal = this.top >= 0 && this.top <= Math.max(0, this.height - this.clientHeight);
    this.height = value;
    if (wasLegal && this.top > Math.max(0, value - this.clientHeight)) this.native(Math.max(0, value - this.clientHeight));
  }
  get scrollTop() { return this.top; }
  set scrollTop(value: number) {
    this.writes.push(value);
    const next = this.quantized ? Math.round(value) : value;
    if (next !== this.top) { this.top = next; pendingScroll.add(this); }
  }
  native(value: number) { this.top = value; this.dispatchEvent(new Event('scroll')); }
  emit(type: string, properties: Record<string, unknown> = {}) { const event = Object.assign(new Event(type, { cancelable: true }), properties); this.dispatchEvent(event); return event; }
}
class FakeMedia extends EventTarget {
  matches = false;
  change(matches: boolean) { this.matches = matches; this.dispatchEvent(new Event('change')); }
}
let media: FakeMedia;
const restorers: (() => void)[] = [], controllers: ReturnType<typeof attachReasoningScroll>[] = [];
const replaceGlobal = (key: string, value: unknown) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  restorers.push(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
};
beforeEach(() => {
  now = nextFrame = 0; media = new FakeMedia();
  page = Object.assign(new EventTarget(), { hidden: false });
  replaceGlobal('performance', { now: () => now });
  replaceGlobal('Element', FakeElement);
  replaceGlobal('matchMedia', () => media);
  replaceGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  replaceGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  replaceGlobal('ResizeObserver', class { constructor(private callback: () => void) { observers.add(callback); } observe() {} disconnect() { observers.delete(this.callback); } });
});
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.destroy());
  frames.clear(); observers.clear(); pendingScroll.clear();
  restorers.splice(0).toReversed().forEach(restore => restore());
});
function frame(count = 1, delta = 1000 / 60) {
  for (let i = 0; i < count; i++) {
    now += delta;
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(now));
    const scrolling = [...pendingScroll]; pendingScroll.clear();
    scrolling.forEach(view => view.dispatchEvent(new Event('scroll')));
  }
}
const resize = () => observers.forEach(callback => callback());
function setup(live = true, clientHeight = 200, height = 1000, quantized = false) {
  const view = new FakeViewport(clientHeight, height, quantized), content = new FakeElement(), statuses: ReasoningScrollStatus[] = [];
  const controller = attachReasoningScroll(view as unknown as HTMLElement, content as unknown as HTMLElement, live, status => statuses.push(status));
  controllers.push(controller);
  return { view, controller, statuses, status: () => statuses.at(-1) ?? { following: true, overflowing: false } };
}

test.each([160, 224])('reasoning capped at %spx starts softly, follows monotonically, and updates React only for controls', cap => {
  const { view, statuses } = setup(true, cap, cap);
  frame(60);
  expect(view.writes).toEqual([]);
  view.scrollHeight += 800; resize();
  frame(6);
  expect(view.scrollTop).toBeGreaterThan(0);
  expect(view.scrollTop).toBeLessThan(25);
  frame(114);
  expect(view.scrollTop).toBe(800);
  expect(view.writes.every((value, i, writes) => value >= (writes[i - 1] ?? 0) && value <= 800)).toBe(true);
  expect(statuses).toEqual([{ following: true, overflowing: true }]);
  expect(view.styles.get('--reasoning-fade-top')).toBe('1');
  expect(view.styles.get('--reasoning-fade-bottom')).toBe('0');
  frame(2);
  expect(frames.size).toBe(0);
});

test('streamed content updates keep momentum instead of restarting the ramp', () => {
  const { view, controller, statuses } = setup(true, 160, 160);
  for (let i = 0; i < 180; i++) {
    if (i % 6 === 0) view.scrollHeight += 24;
    controller.update(true); resize(); frame();
  }
  expect(view.scrollTop).toBeGreaterThan(650);
  expect(statuses).toEqual([{ following: true, overflowing: true }]);
  expect(view.writes.every((value, i, writes) => value >= (writes[i - 1] ?? 0))).toBe(true);
});

test('slow foreground frames retain elapsed time and hidden time preserves pending momentum', () => {
  const { view, controller } = setup();
  frame(10, 50);
  const before = view.scrollTop;
  expect(before).toBeGreaterThan(540);
  page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
  view.scrollHeight += 24; controller.update(true); resize(); frame(10, 1000);
  expect(view.scrollTop).toBe(before);
  expect(frames.size).toBe(0);
  page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); frame();
  expect(view.scrollTop - before).toBeGreaterThan(10);
  expect(view.scrollTop - before).toBeLessThan(30);
  controller.destroy(); page.dispatchEvent(new Event('visibilitychange'));
  expect(frames.size).toBe(0);
});

test.each(['wheel', 'ArrowUp', 'PageUp', 'Home', 'ShiftSpace', 'touch'])('%s interrupts pending motion and explicit resume starts softly at the reader position', gesture => {
  const { view, controller, status } = setup();
  frame(20);
  if (gesture === 'wheel') view.emit('wheel', { deltaY: -20 });
  else if (gesture === 'touch') { view.emit('touchstart', { touches: [{ clientY: 100 }] }); view.emit('touchmove', { touches: [{ clientY: 130 }] }); }
  else view.emit('keydown', { key: gesture === 'ShiftSpace' ? ' ' : gesture, shiftKey: gesture === 'ShiftSpace' });
  const paused = view.scrollTop;
  view.writes.length = 0; frame(5);
  expect(view.scrollTop).toBe(paused);
  expect(view.writes).toEqual([]);
  view.native(paused - 100);
  view.scrollHeight += 100; controller.update(true); resize(); frame(30);
  expect(view.writes).toEqual([]);
  expect(status().following).toBe(false);
  const start = view.scrollTop;
  controller.resume(); frame();
  expect(view.scrollTop).toBeGreaterThanOrEqual(start);
  expect(view.scrollTop - start).toBeLessThan(0.1);
  frame(120);
  expect(view.scrollTop).toBe(900);
  expect(status().following).toBe(true);
});

test('layout shrink and a programmatic bottom arrival do not rearm a paused reader; downward intent can', () => {
  const { view, status } = setup();
  frame(20); view.emit('wheel', { deltaY: -1 });
  view.scrollHeight = view.scrollTop + view.clientHeight; resize(); frame();
  expect(status().following).toBe(false);
  view.scrollHeight += 100; resize(); frame();
  view.native(view.scrollHeight - view.clientHeight); frame();
  expect(status().following).toBe(false);
  view.native(view.scrollTop - 20);
  view.emit('wheel', { deltaY: 20 }); view.native(view.scrollTop + 20); frame();
  expect(status().following).toBe(true);
});

test.each(['ArrowDown', 'PageDown', ' '])('%s leaves native keyboard scrolling in charge and End resumes at the actual bottom', key => {
  const { view, status } = setup();
  frame(20); view.emit('keydown', { key }); const paused = view.scrollTop;
  frame(10);
  expect(view.scrollTop).toBe(paused);
  expect(status().following).toBe(false);
  const end = view.emit('keydown', { key: 'End' });
  expect(end.defaultPrevented).toBe(true);
  expect(view.scrollTop).toBe(800);
  expect(status().following).toBe(true);
});

test('completion or opened history stops the pending spring; explicit history resume is a single movement', () => {
  const { view, controller, status } = setup();
  frame(20);
  const stopped = view.scrollTop;
  controller.update(false); view.scrollHeight += 100; resize(); view.writes.length = 0; frame(30);
  expect(view.scrollTop).toBe(stopped);
  expect(view.writes).toEqual([]);
  expect(status().following).toBe(false);
  controller.resume(); frame(120);
  expect(view.scrollTop).toBe(900);
  view.scrollHeight += 100; resize(); frame(30);
  expect(view.scrollTop).toBe(900);
});

test('reduced motion follows immediately, including a preference change during motion', () => {
  const { view } = setup();
  frame(6); expect(view.scrollTop).toBeLessThan(25);
  media.change(true); frame();
  expect(view.scrollTop).toBe(800);
  view.scrollHeight += 100; resize(); frame();
  expect(view.scrollTop).toBe(900);
  view.emit('wheel', { deltaY: -1 }); view.native(300);
  view.scrollHeight += 100; resize(); frame();
  expect(view.scrollTop).toBe(300);
});

test.each([-40, 840])('elastic offset %s survives automatic following and resumes smoothly after native settlement', top => {
  const { view, status } = setup();
  view.native(top); frame();
  view.scrollHeight = 1020; resize(); frame();
  expect(view.writes).toEqual([]);
  expect(view.scrollTop).toBe(top);
  const normalized = Math.max(0, Math.min(800, top));
  view.native(normalized); frame();
  expect(status().following).toBe(true);
  expect(view.scrollTop).toBeGreaterThanOrEqual(normalized);
  expect(view.scrollTop - normalized).toBeLessThan(0.1);
  frame(120);
  expect(view.scrollTop).toBe(820);
});

test('explicit resume can exit elastic offsets, including finished history', () => {
  const { view, controller } = setup(false);
  view.native(-40); frame();
  expect(reasoningScrollTop(view)).toBe(0);
  expect(view.writes).toEqual([]);
  controller.resume();
  expect(view.scrollTop).toBe(0);
  frame(120);
  expect(view.scrollTop).toBe(800);
});

test('quantized native downward advances are adopted without pullback', () => {
  const { view } = setup(true, 200, 2000, true);
  frame(20);
  const advanced = view.scrollTop + 1;
  view.native(advanced); view.writes.length = 0; frame();
  expect(view.writes.length).toBeGreaterThan(0);
  expect(Math.min(...view.writes)).toBeGreaterThanOrEqual(advanced);
  expect(view.scrollTop).toBeGreaterThanOrEqual(advanced);
});

test('destroy removes observers, scheduled animation and input listeners', () => {
  const { view, controller, statuses } = setup();
  frame(10); controller.destroy(); view.writes.length = 0; statuses.length = 0;
  view.emit('wheel', { deltaY: -1 }); view.emit('keydown', { key: 'End' }); media.change(true); resize(); frame(10);
  expect(view.writes).toEqual([]);
  expect(statuses).toEqual([]);
  expect(frames.size).toBe(0);
  expect(observers.size).toBe(0);
});

test('a source preview follows final asynchronous highlighting even when it arrives after EOF settlement', () => {
  const view = new FakeViewport(320, 320), content = new FakeElement(), measurements: number[][] = [];
  const controller = attachReasoningScroll(view as unknown as HTMLElement, content as unknown as HTMLElement, true, () => {}, { followAfterCompletion: true, onMeasure: (top, bottom) => measurements.push([top, bottom]) });
  controllers.push(controller);
  for (let i = 0; i < 120; i++) { if (i % 6 === 0) view.scrollHeight += 20; controller.update(true); resize(); frame(); }
  const before = view.scrollTop;
  controller.update(false); view.scrollHeight += 40; resize(); frame(120);
  expect(view.scrollTop).toBe(440);
  expect(view.scrollTop).toBeGreaterThan(before);
  expect(measurements.at(-1)).toEqual([440, 0]);
  view.scrollHeight += 200; resize(); frame(120);
  expect(view.scrollTop).toBe(640);
});

test.each([false, true])('source settlement never takes ownership from static history or a paused reader (paused=%s)', paused => {
  const view = new FakeViewport(), content = new FakeElement();
  const controller = attachReasoningScroll(view as unknown as HTMLElement, content as unknown as HTMLElement, paused, () => {}, { followAfterCompletion: true });
  controllers.push(controller);
  if (paused) { frame(12); view.emit('wheel', { deltaY: -20 }); }
  controller.update(false);
  const before = view.scrollTop;
  view.scrollHeight += 200; resize(); frame(120);
  expect(view.scrollTop).toBe(before);
});
