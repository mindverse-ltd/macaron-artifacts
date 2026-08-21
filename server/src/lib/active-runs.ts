// In-memory registry of the AbortController for each in-flight SDK stream,
// keyed by sessionId. The /stop route looks up the controller and fires
// `.abort()`, which the SDK subprocess honours by killing the child and
// throwing on the async iterator — the surrounding SSE handler then closes.
//
// The run's analytics id rides along so /stop can attribute run_interrupted to
// the same run as its run_started, and so /live can hand a reattaching client
// the id of the run already in flight.

import { track } from './telemetry.js';
import { ENGINE } from '../config.js';

type Run = { ac: AbortController; runId?: string };
const runs = new Map<string, Run>();

export function registerRun(sid: string, ac: AbortController, runId?: string): void {
  runs.set(sid, { ac, runId });
}

export function claimRun(sid: string, ac: AbortController, runId?: string): boolean {
  if (runs.has(sid)) return false;
  runs.set(sid, { ac, runId });
  return true;
}

/** The in-flight run's analytics id, for surfaces that join a run they did not
 * start (/live reattach, /stop). */
export function runIdOf(sid: string): string | undefined {
  return runs.get(sid)?.runId;
}

export function abortRun(sid: string): boolean {
  const run = runs.get(sid);
  if (!run || run.ac.signal.aborted) return false;
  // Abort requests cancellation but deliberately keeps the claim. Releasing
  // it before the SDK iterator settles could let a second resume start while
  // the old runner is still unwinding and able to write to the same transcript
  // or live entry. The owning route releases the claim at terminal cleanup.
  run.ac.abort();
  track('run_interrupted', { engine: ENGINE, runId: run.runId });
  return true;
}

export function endRun(sid: string, owner?: AbortController): boolean {
  if (owner && runs.get(sid)?.ac !== owner) return false;
  return runs.delete(sid);
}
