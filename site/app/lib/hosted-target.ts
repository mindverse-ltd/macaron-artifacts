// Turn a validated server target (from buildTarget: `<origin>/?token=<t>`) into
// the SAME-ORIGIN hosted-route URL that opens the WebUI we host under /app and
// points it at that server. This is the difference between the old flow (a full
// redirect to the server's own origin) and hosting: we stay on the docs origin,
// load our staged SPA, and pass the server as `?server=` for apiBase to consume.
//
// Claude Code → /app (index.html), Codex → /app/codex (codex.html). The server
// origin and token ride as query params; the WebUI's consumeServerFromUrl binds
// the token to that origin and scrubs both from the URL on first load.
export type Engine = 'claude' | 'codex';

const ROUTE: Record<Engine, string> = { claude: '/app', codex: '/app/codex' };

// `serverHref` is buildTarget's output, already normalized to `<origin>/` with
// an optional `?token=`. We split it back into origin + token so the hosted
// route gets `?server=<origin>` (no trailing `/`, path already dropped upstream)
// and `?token=<t>` only when present.
export function hostedTarget(serverHref: string, engine: Engine): string {
  const u = new URL(serverHref);
  const token = u.searchParams.get('token') || '';
  const target = new URL(ROUTE[engine], 'https://placeholder.invalid');
  target.searchParams.set('server', u.origin);
  if (token) target.searchParams.set('token', token);
  return target.pathname + target.search; // relative, same-origin
}
