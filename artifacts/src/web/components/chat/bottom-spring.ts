// Gallery's card-growth model: macaron-genui-demo@d2503903, src/components/gallery/gallerySpringMotion.ts:218–269.
export const BOTTOM_SCROLL_SLACK = 0;
// Large card mounts need a gentler follow speed to keep text legible under 2× frame blending.
const W = 2 * Math.PI * 1.0;
export type BottomSpring = { position: number; velocity: number; target: number };
export const bottomScrollTarget = (wall: number, slack = BOTTOM_SCROLL_SLACK) => Math.max(0, wall - slack);
export const createBottomSpring = (position: number, wall: number, slack = BOTTOM_SCROLL_SLACK): BottomSpring => {
  const target = bottomScrollTarget(wall, slack);
  return { position: Math.min(target, Math.max(0, position)), velocity: 0, target };
};

export function stepBottomSpring(state: BottomSpring, wall: number, elapsedMs: number, slack = BOTTOM_SCROLL_SLACK): BottomSpring {
  const target = bottomScrollTarget(wall, slack);
  // Reflow or a changed inset can move the legal target behind us. Synchronize once; this is layout correction, not spring rebound.
  if (state.position > target || state.position < 0) return createBottomSpring(state.position, wall, slack);
  const rawDt = elapsedMs / 1000, gap = target - state.position;
  // 0 <= v <= W * gap is invariant under growth and abrupt stops. Project only unsafe initial/reflow momentum into that cone.
  const velocity = Math.min(Math.max(0, state.velocity), W * gap);
  // A repeated timestamp still updates the destination, or the caller could mistake the previous destination for a settled spring.
  if (!(rawDt > 0)) return target === state.target && velocity === state.velocity ? state : { ...state, velocity, target };
  const dt = Math.min(rawDt, 1 / 30), c = W * gap - velocity, decay = Math.exp(-W * dt);
  // Exact critical damping: gap(t)=(gap+c*t)e^-Wt, v(t)=(v+W*c*t)e^-Wt. Both stay nonnegative; Euler steps need not.
  const position = Math.min(target, Math.max(state.position, target - (gap + c * dt) * decay));
  // The bounds absorb floating-point roundoff; the elapsed-time cap preserves continuity after a background pause.
  return { position, velocity: Math.min(W * (target - position), Math.max(0, (velocity + W * c * dt) * decay)), target };
}

// Velocity survives between streamed lines; only stop once both motion and the remaining distance are negligible.
export const bottomSpringSettled = (state: BottomSpring) => Math.abs(state.position - state.target) < 0.25 && Math.abs(state.velocity) < 0.5;

export const BOTTOM_SPRING_STARTUP_MS = 250;
const startupTime = (elapsed: number) => {
  const u = Math.min(1, elapsed / BOTTOM_SPRING_STARTUP_MS);
  return BOTTOM_SPRING_STARTUP_MS * (u ** 3 - u ** 4 / 2) + Math.max(0, elapsed - BOTTOM_SPRING_STARTUP_MS);
};

// Integrate a 0→1 smoothstep clock, rather than easing the target or resetting momentum on each token.
// Nonnegative clock speed preserves the spring's monotonic/no-overshoot proof. Reset elapsed only at rest or on interruption.
export function stepBottomSpringClock(elapsed: number, frameMs: number) {
  const next = elapsed + Math.min(1000 / 30, Math.max(0, frameMs));
  return { elapsed: Math.min(BOTTOM_SPRING_STARTUP_MS, next), delta: startupTime(next) - startupTime(elapsed) };
}
