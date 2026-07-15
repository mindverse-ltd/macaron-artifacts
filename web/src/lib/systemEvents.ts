// Singleton client for the server's system event stream (/api/events). One
// EventSource is shared across every component that cares about "the session
// list changed on disk" — the Dashboard, the sidebar, the workspace canvas —
// so a terminal-started `claude`/`codex` run surfaces live instead of waiting
// for each view's slow interval poll. EventSource reconnects on its own if the
// server restarts, so there's no manual retry loop here.

import type { SystemEvent } from '@macaron/shared';
import { getToken } from './auth';
import { getApiBase, resolveApiUrl } from './apiBase';

type Listener = (ev: SystemEvent) => void;

let source: EventSource | null = null;
const listeners = new Set<Listener>();

function systemEventsUrl(): string {
  const token = getToken();
  return resolveApiUrl(token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events');
}

function ensureSource(): void {
  if (source) return;
  // Cross-origin hosted mode needs credentialed CORS on the SSE stream; same
  // origin keeps the default so nothing changes for the local server.
  source = new EventSource(systemEventsUrl(), getApiBase() ? { withCredentials: true } : undefined);
  source.onmessage = (e) => {
    let payload: SystemEvent | { type: string };
    try {
      payload = JSON.parse(e.data);
    } catch {
      return;
    }
    if ((payload as SystemEvent).type === 'sessions-changed') {
      for (const l of listeners) l(payload as SystemEvent);
    }
  };
  // On error EventSource retries automatically; nothing to do but keep it.
  source.onerror = () => {};
}

export function subscribeSystemEvents(cb: Listener): () => void {
  listeners.add(cb);
  ensureSource();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}
