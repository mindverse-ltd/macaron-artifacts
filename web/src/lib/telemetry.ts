// Client-side umami reporting. Nothing loads and nothing is sent unless the
// server answers GET /api/telemetry with enabled:true (i.e. not MACARON_TELEMETRY=0).
//
// No community React wrapper — the umami tracker exposes a global, and
// @types/umami-browser already types it. All we add is the typed event map and
// a queue so events fired before the script finishes loading aren't dropped.

import type { AnalyticsEvents, TelemetryConfig } from '@macaron/shared';
import { authedFetch } from './auth';

type Loaded = { track: (name: string, data?: Record<string, unknown>) => void };

let umami: Loaded | null = null;
const queue: Array<[string, Record<string, unknown> | undefined]> = [];

export function track<K extends keyof AnalyticsEvents>(name: K, data: AnalyticsEvents[K]): void {
  const payload = data as Record<string, unknown>;
  if (!umami) { if (queue.length < 100) queue.push([name, payload]); return; }
  umami.track(name, payload);
}

/** Emit route_view for the current route and for every navigation after it.
 * Structurally typed so the three engine bundles can pass their own router. */
type RouteState = { matches: Array<{ route: { path?: string } }> };
export function trackRoutes(router: { state: RouteState; subscribe: (fn: (s: RouteState) => void) => unknown }): void {
  const emit = (s: RouteState) => track('route_view', { path: '/' + (s.matches[s.matches.length - 1]?.route.path ?? '') });
  emit(router.state);
  router.subscribe(emit);
}

/** Boot: ask the server whether telemetry is on, and only then inject the
 * tracker. Failure to reach /api/telemetry leaves everything off. */
export async function initTelemetry(): Promise<void> {
  let cfg: TelemetryConfig;
  try {
    const r = await authedFetch('/api/telemetry');
    if (!r.ok) return;
    cfg = (await r.json()) as TelemetryConfig;
  } catch { return; }
  if (!cfg.enabled) { queue.length = 0; return; }

  const el = document.createElement('script');
  el.async = true;
  el.src = `${cfg.host}${cfg.scriptPath}`;
  el.dataset.websiteId = cfg.websiteId;
  // Honour the browser's Do Not Track signal — the tracker checks this itself
  // and stays silent rather than us having to gate every call site.
  el.dataset.doNotTrack = 'true';
  el.dataset.autoTrack = 'false';   // route_view is emitted by the hash router, not by URL polling
  // The tracker attaches the page URL's query string to every event. A share or
  // tunnel link carries `?token=<live credential>` (see server lib/auth.ts), and
  // main.tsx preserves that query when it rewrites the URL into a hash route —
  // so without this the token would be shipped to the collector on every event.
  el.dataset.excludeSearch = 'true';
  el.addEventListener('load', () => {
    umami = (window as unknown as { umami?: Loaded }).umami ?? null;
    if (!umami) return;
    for (const [name, data] of queue.splice(0, queue.length)) umami.track(name, data);
  });
  document.head.appendChild(el);
}
