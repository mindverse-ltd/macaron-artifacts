// Single source of truth for every analytics event macaron emits, client and
// server alike. Adding an event means adding a line here — `track()` on both
// sides is keyed off this map, so a typo in a name or a payload is a type error.
//
// Telemetry is on by default; MACARON_TELEMETRY=0 disables it entirely.

export interface AnalyticsEvents {
  /** SPA booted. One per page load, per engine bundle. */
  app_mounted: { engine: string };
  /** Hash-router navigation, including the initial route. Carries the matched
   * route PATTERN, never the URL: `:project` params are absolute filesystem paths. */
  route_view: { path: string };

  /** Server-side: HTTP requests worth looking at — failures, slow responses, and
   * every mutation. Successful fast GETs are deliberately not reported. */
  request: { route: string; method: string; status: number; durationMs: number };

  run_started: { engine: string; resumed: boolean; hasImages: boolean; promptLen: number };
  /** Fired from abortRun() — the one place all three engines' /stop converge. */
  run_interrupted: { engine: string };
  run_finished: { engine: string; durationMs: number; ok: boolean };
  /** Client lost the SSE stream (tab closed, network drop, abort). */
  stream_disconnected: { engine: string; durationMs: number };

  /** Server-side: the model actually called render_ui. */
  render_ui_called: { engine: string; codeLen: number; diagnostics: number };
  /** Client-side: the card reached the screen. The gap vs. called is the funnel. */
  render_ui_rendered: { codeLen: number };
  render_ui_failed: { phase: string; message: string };

  error: { where: string; message: string };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/** What GET /api/telemetry answers. Empty host/websiteId when disabled. */
export type TelemetryConfig = { enabled: boolean; host: string; websiteId: string; scriptPath: string };
