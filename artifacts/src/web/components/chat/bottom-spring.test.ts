import { describe, expect, test } from 'bun:test';
import { BOTTOM_SCROLL_SLACK, BOTTOM_SPRING_STARTUP_MS, bottomScrollTarget, bottomSpringSettled, createBottomSpring, stepBottomSpring, stepBottomSpringClock } from './bottom-spring';

const grow = (hz: number) => {
  let state = createBottomSpring(0, BOTTOM_SCROLL_SLACK);
  const velocities: number[] = [];
  for (let frame = 1; frame <= hz * 6; frame++) {
    state = stepBottomSpring(state, BOTTOM_SCROLL_SLACK + 24 * Math.floor(frame / hz / 0.12), 1000 / hz);
    if (frame > hz) velocities.push(state.velocity);
  }
  return { state, velocities };
};

describe('streaming bottom spring', () => {
  test('targets the physical bottom by default and preserves an explicit inset', () => {
    expect(bottomScrollTarget(0)).toBe(0);
    expect(bottomScrollTarget(30)).toBe(30);
    expect(bottomScrollTarget(1200 + BOTTOM_SCROLL_SLACK)).toBe(1200);
    expect(bottomScrollTarget(1248, 48)).toBe(1200);
    expect(bottomScrollTarget(30, 48)).toBe(0);
  });

  test('retains momentum between streamed lines at 30, 60 and 120 Hz', () => {
    const runs = [30, 60, 120].map(grow);
    for (const { state, velocities } of runs) {
      expect(Math.min(...velocities)).toBeGreaterThan(150);
      expect(Math.max(...velocities)).toBeLessThan(260);
      expect(bottomSpringSettled(state)).toBe(false);
    }
    expect(Math.abs(runs[0].state.position - runs[2].state.position)).toBeLessThan(12);
  });

  test('an abrupt stop settles without crossing the target or moving backward, then resumes after idle', () => {
    let { state } = grow(60);
    for (let frame = 0; frame < 360; frame++) {
      const next = stepBottomSpring(state, 1200, 1000 / 60);
      expect(next.position).toBeGreaterThanOrEqual(state.position);
      expect(next.position).toBeLessThanOrEqual(1200);
      state = next;
    }
    expect(bottomSpringSettled(state)).toBe(true);
    expect(state.position).toBeCloseTo(1200, 3);
    const resumed = stepBottomSpring(state, 1224, 1000 / 60);
    expect(resumed.velocity).toBeGreaterThan(0);
    expect(bottomSpringSettled(resumed)).toBe(false);
  });

  test('position alone does not cancel pending momentum', () => {
    const idle = createBottomSpring(1200, 1200);
    expect(bottomSpringSettled(idle)).toBe(true);
    expect(bottomSpringSettled({ ...idle, velocity: 20 })).toBe(false);
  });

  test('duplicate timestamps preserve position without falsely settling; long steps remain stable', () => {
    const initial = createBottomSpring(200, 200);
    expect(stepBottomSpring(initial, 200, 0)).toBe(initial);
    const paused = stepBottomSpring(initial, 400, 0);
    expect(paused).toEqual({ position: 200, velocity: 0, target: 400 });
    expect(bottomSpringSettled(paused)).toBe(false);
    expect(stepBottomSpring(initial, 400, -10)).toEqual(paused);
    const resumed = stepBottomSpring(initial, 400, 10_000);
    expect(Number.isFinite(resumed.position)).toBe(true);
    expect(resumed.position).toBe(400);
    expect(resumed.velocity).toBeCloseTo(0, 8);
  });

  test('content collapse clamps stale position and clears outgoing momentum', () => {
    const { state } = grow(60);
    const collapsed = stepBottomSpring(state, 300, 1000 / 60);
    expect(collapsed.position).toBe(300);
    expect(collapsed.velocity).toBe(0);
    expect(collapsed.target).toBe(300);
    const empty = stepBottomSpring(collapsed, 0, 1000 / 60);
    expect(empty.position).toBe(0);
    expect(bottomSpringSettled(empty)).toBe(true);
  });

  test('zero-slack canvas reaches its actual end without adding layout padding', () => {
    let state = createBottomSpring(0, 1000, 0);
    expect(state.target).toBe(1000);
    for (let frame = 0; frame < 600; frame++) state = stepBottomSpring(state, 1000, 1000 / 60, 0);
    expect(state.position).toBeCloseTo(1000, 3);
    expect(bottomSpringSettled(state)).toBe(true);
    const collapsed = stepBottomSpring(state, 200, 1000 / 60, 0);
    expect(collapsed.position).toBe(200);
    expect(collapsed.target).toBe(200);
  });

  test('unsafe nonzero initial velocities never cross a fixed target or reverse', () => {
    for (const velocity of [-500, 0, 10, 5000]) {
      let state = { ...createBottomSpring(999, 1000), velocity };
      for (let frame = 0; frame < 240; frame++) {
        const next = stepBottomSpring(state, 1000, 1000 / 120);
        expect(next.position).toBeGreaterThanOrEqual(state.position);
        expect(next.position).toBeLessThanOrEqual(1000);
        expect(next.velocity).toBeGreaterThanOrEqual(0);
        state = next;
      }
    }
  });

  test('safe velocity remains continuous when the target grows instead of restarting at rest', () => {
    const state = { ...createBottomSpring(100, 200), velocity: 200 };
    const next = stepBottomSpring(state, 300, 0.00001);
    expect(next.velocity).toBeCloseTo(200, 3);
    expect(next.position).toBeGreaterThan(100);
    expect(next.position).toBeCloseTo(100, 3);
  });

  test('a smaller target still ahead brakes without overshooting', () => {
    let state = { ...createBottomSpring(199, 2000), velocity: 5000 };
    for (let frame = 0; frame < 180; frame++) {
      const next = stepBottomSpring(state, 200, 1000 / 60);
      expect(next.position).toBeGreaterThanOrEqual(state.position);
      expect(next.position).toBeLessThanOrEqual(200);
      state = next;
    }
  });

  test('changing only the inset corrects once, including at a duplicate timestamp', () => {
    const initial = createBottomSpring(1000, 1000), resized = stepBottomSpring(initial, 1000, 0, 48);
    expect(resized.position).toBe(952);
    expect(resized.velocity).toBe(0);
    for (let frame = 0; frame < 30; frame++) expect(stepBottomSpring(resized, 1000, 1000 / 60, 48)).toEqual(resized);
    const restored = stepBottomSpring(resized, 1000, 1000 / 60, 0);
    expect(restored.position).toBeGreaterThan(952);
    expect(restored.position).toBeLessThan(1000);
    expect(createBottomSpring(1000, 1000).position).toBe(1000);
  });

  test('fixed-target motion agrees across fast and slow foreground frames', () => {
    const states = [10, 20, 30, 60, 120, 240].map(hz => {
      let state = createBottomSpring(0, 1000);
      for (let frame = 0; frame < hz / 2; frame++) state = stepBottomSpring(state, 1000, 1000 / hz);
      return state;
    });
    for (const state of states.slice(1)) {
      expect(state.position).toBeCloseTo(states[0].position, 8);
      expect(state.velocity).toBeCloseTo(states[0].velocity, 8);
    }
  });

  test('small streamed steps and sudden large mounts remain monotone across delayed frames', () => {
    let state = createBottomSpring(0, 0), wall = 0;
    for (let frame = 0; frame < 2000; frame++) {
      wall += frame % 113 === 0 ? 800 : frame % 7 === 0 ? 1 : 0;
      const next = stepBottomSpring(state, wall, frame % 137 === 0 ? 10_000 : [1000 / 240, 1000 / 60, 1000 / 30][frame % 3]);
      expect(next.position).toBeGreaterThanOrEqual(state.position);
      expect(next.position).toBeLessThanOrEqual(wall);
      expect(Number.isFinite(next.velocity)).toBe(true);
      state = next;
    }
  });
});

describe('bottom spring startup clock', () => {
  const run = (hz: number, target = 800) => {
    let state = createBottomSpring(0, target), startup = 0;
    const samples = [];
    for (let frame = 1; frame <= hz * 2; frame++) {
      const clock = stepBottomSpringClock(startup, 1000 / hz); startup = clock.elapsed;
      const next = stepBottomSpring(state, target, clock.delta), u = startup / BOTTOM_SPRING_STARTUP_MS;
      samples.push({ time: frame / hz * 1000, position: next.position, velocity: next.velocity * u * u * (3 - 2 * u) });
      expect(next.position).toBeGreaterThanOrEqual(state.position);
      expect(next.position).toBeLessThanOrEqual(target);
      state = next;
    }
    return samples;
  };

  test('extends the visible ease-in while preserving the same no-overshoot trajectory', () => {
    const samples = run(120);
    const at = (ms: number) => samples.find(sample => Math.abs(sample.time - ms) < 0.01)!;
    expect(at(50).position).toBeLessThan(1);
    expect(at(100).position).toBeLessThan(25);
    expect(at(50).velocity).toBeLessThan(at(100).velocity);
    expect(at(100).velocity).toBeLessThan(at(150).velocity);
    expect(at(150).velocity).toBeLessThan(at(200).velocity);
    // A 1Hz spring peaks after startup; the hook finishes at its settling thresholds, not at the asymptotic limit.
    expect(at(350).velocity).toBeLessThan(at(300).velocity);
    expect(bottomSpringSettled({ ...at(2000), target: 800 })).toBe(true);
  });

  test('integrated startup agrees across display refresh rates', () => {
    const samples = [10, 20, 30, 60, 120, 240].map(hz => run(hz).filter(sample => Math.abs(sample.time % 100) < 0.001));
    for (const run of samples.slice(1)) for (let i = 0; i < samples[0].length; i++) {
      expect(run[i].position).toBeCloseTo(samples[0][i].position, 8);
      expect(run[i].velocity).toBeCloseTo(samples[0][i].velocity, 8);
    }
  });

  test('duplicate timestamps stay still and delayed frames retain elapsed foreground time', () => {
    expect(stepBottomSpringClock(0, -10)).toEqual({ elapsed: 0, delta: 0 });
    expect(stepBottomSpringClock(100, 0)).toEqual({ elapsed: 100, delta: 0 });
    expect(stepBottomSpringClock(0, 100).delta).toBeCloseTo(12.8, 8);
    expect(stepBottomSpringClock(0, 10_000)).toEqual({ elapsed: 250, delta: 9875 });
    expect(stepBottomSpringClock(250, 1000 / 60).delta).toBeCloseTo(1000 / 60, 10);
  });

  test('streamed growth retains the startup clock and momentum instead of restarting per token', () => {
    let state = createBottomSpring(0, 0), startup = 0, target = 0;
    for (let frame = 0; frame < 360; frame++) {
      if (frame % 6 === 0) target += 24;
      const clock = stepBottomSpringClock(startup, 1000 / 60); startup = clock.elapsed;
      const next = stepBottomSpring(state, target, clock.delta);
      expect(next.position).toBeGreaterThanOrEqual(state.position);
      expect(next.position).toBeLessThanOrEqual(target);
      if (frame > 120) expect(next.velocity).toBeGreaterThan(210);
      state = next;
    }
    expect(startup).toBe(BOTTOM_SPRING_STARTUP_MS);
  });
});
