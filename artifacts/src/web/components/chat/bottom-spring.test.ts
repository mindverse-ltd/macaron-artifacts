import { describe, expect, test } from 'bun:test';
import { BOTTOM_SCROLL_SLACK, bottomScrollTarget, bottomSpringSettled, createBottomSpring, stepBottomSpring } from './bottom-spring';

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
  test('reserves physical overshoot room without hiding the last line', () => {
    expect(bottomScrollTarget(0)).toBe(0);
    expect(bottomScrollTarget(30)).toBe(0);
    expect(bottomScrollTarget(1200 + BOTTOM_SCROLL_SLACK)).toBe(1200);
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

  test('coasts into the slack then settles, and can resume after idle', () => {
    let { state } = grow(60);
    let furthest = state.position;
    for (let frame = 0; frame < 360; frame++) {
      state = stepBottomSpring(state, 1248, 1000 / 60);
      furthest = Math.max(furthest, state.position);
    }
    expect(furthest).toBeGreaterThan(1200);
    expect(furthest).toBeLessThanOrEqual(1248);
    expect(bottomSpringSettled(state)).toBe(true);
    expect(state.position).toBeCloseTo(1200, 3);
    const resumed = stepBottomSpring(state, 1272, 1000 / 60);
    expect(resumed.velocity).toBeGreaterThan(0);
    expect(bottomSpringSettled(resumed)).toBe(false);
  });

  test('position alone does not cancel pending momentum', () => {
    const idle = createBottomSpring(1200, 1248);
    expect(bottomSpringSettled(idle)).toBe(true);
    expect(bottomSpringSettled({ ...idle, targetVelocity: 20 })).toBe(false);
    expect(bottomSpringSettled({ ...idle, aim: 1204 })).toBe(false);
  });

  test('duplicate timestamps preserve state; a background pause cannot amplify growth rate', () => {
    const initial = createBottomSpring(200, 248);
    expect(stepBottomSpring(initial, 448, 0)).toBe(initial);
    expect(stepBottomSpring(initial, 448, -10)).toBe(initial);
    const resumed = stepBottomSpring(initial, 448, 10_000), nextFrame = stepBottomSpring(initial, 448, 1000 / 60);
    expect(resumed.targetVelocity).toBeLessThan(nextFrame.targetVelocity);
    expect(Number.isFinite(resumed.position)).toBe(true);
    expect(resumed.position).toBeLessThan(248);
  });

  test('content collapse clamps stale position and clears outgoing momentum', () => {
    const { state } = grow(60);
    const collapsed = stepBottomSpring(state, 300, 1000 / 60);
    expect(collapsed.position).toBe(300);
    expect(collapsed.velocity).toBe(0);
    expect(collapsed.targetVelocity).toBe(0);
    expect(collapsed.target).toBe(252);
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
});
