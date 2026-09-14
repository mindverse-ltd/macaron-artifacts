// Gallery's streaming scroll model: macaron-genui-demo@d2503903, src/components/gallery/gallerySpringMotion.ts:84–184.
export const BOTTOM_SCROLL_SLACK = 48;
const FREQUENCY = 1.7, DAMPING = 1.5, LEAD = 0.12 * 2.5, AIM_MEMORY = 0.25, RATE_MEMORY = 0.35;
export type BottomSpring = { position: number; velocity: number; target: number; targetVelocity: number; aim: number };
export const bottomScrollTarget = (wall: number, slack = BOTTOM_SCROLL_SLACK) => Math.max(0, wall - slack);
export const createBottomSpring = (position: number, wall: number, slack = BOTTOM_SCROLL_SLACK): BottomSpring => ({ position, velocity: 0, target: bottomScrollTarget(wall, slack), targetVelocity: 0, aim: bottomScrollTarget(wall, slack) });

export function stepBottomSpring(state: BottomSpring, wall: number, elapsedMs: number, slack = BOTTOM_SCROLL_SLACK): BottomSpring {
  const rawDt = elapsedMs / 1000;
  if (!(rawDt > 0)) return state;
  const target = bottomScrollTarget(wall, slack), dt = Math.min(rawDt, 1 / 30);
  let { position, velocity, targetVelocity, aim } = state;
  if (target < state.target) {
    targetVelocity = 0; aim = target;
    if (position > wall) return createBottomSpring(Math.max(0, wall), wall, slack);
  }
  // Real elapsed time keeps a resumed background tab from turning its accumulated growth into an enormous impulse.
  targetVelocity += (((target - Math.min(state.target, target)) / rawDt) - targetVelocity) * Math.min(1, dt / RATE_MEMORY);
  aim += (target + Math.max(0, targetVelocity) * LEAD - aim) * Math.min(1, dt / AIM_MEMORY);
  aim = Math.min(aim, wall);
  const w = 2 * Math.PI * FREQUENCY;
  velocity += (w * w * (aim - position) - 2 * DAMPING * w * velocity) * dt;
  position += velocity * dt;
  if (position >= wall) { position = wall; velocity = Math.min(velocity, 0); }
  else if (position <= 0) { position = 0; velocity = Math.max(velocity, 0); }
  return { position, velocity, target, targetVelocity, aim };
}

// Include the aim and growth-rate memory: stopping on position alone would restart the spring at every streamed line.
export const bottomSpringSettled = (state: BottomSpring) => Math.abs(state.position - state.target) < 0.25 && Math.abs(state.velocity) < 0.5 && Math.abs(state.aim - state.target) < 0.25 && Math.abs(state.targetVelocity) < 0.5;
