// Normalize a pasted Macaron server URL (+ optional token) into a safe jump
// target `<origin>/?token=<t>`. The macaron server serves its OWN WebUI, so
// "connecting" is a redirect: we send the browser to the server's origin where
// the WebUI loads same-origin (no CORS, no in-page cross-origin fetch). This
// function is the whole security surface, so it fails closed.
//
// Scheme rules:
//   - scheme-less input (`box.example.com`, `localhost:7878`) → assume the
//     right scheme by host: loopback / private hosts get http (the local case
//     the user actually runs), everything else gets https.
//   - explicit `https://` always allowed.
//   - explicit `http://` allowed ONLY for a loopback / private-LAN host — an
//     access token over http to a public host is unsafe and is rejected.
//   - any other explicit scheme (ftp/ws/…) and any userinfo is rejected.
// See MAC-8578 / EVE's review on PR #144 (this revives + widens that gate so
// `http://localhost:7878` works).

export type BuildResult = { href: string } | { error: string };

// Matches a leading URI scheme per RFC 3986 (`scheme ":"`), but NOT a bare
// `host:port` — a scheme's colon is never followed by a digit, whereas
// `localhost:7878` is host:port. So `https://x` / `ftp://x` are schemes, while
// `localhost:7878` is treated as scheme-less and gets its scheme inferred.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

// A host that never leaves the machine / LAN, where an http token is acceptable:
// loopback names, 127.0.0.0/8, ::1, and the RFC1918 / link-local private ranges.
function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

export function buildTarget(rawUrl: string, rawToken: string): BuildResult {
  const input = rawUrl.trim();
  if (!input) return { error: 'Paste your Macaron server URL first.' };

  let parsed: URL;
  try {
    if (HAS_SCHEME.test(input)) {
      parsed = new URL(input);
    } else {
      // Infer the scheme from the host: local hosts default to http (that's how
      // the local server is reached), everything else to https.
      const probe = new URL(`https://${input}`);
      parsed = new URL((isLocalHost(probe.hostname) ? 'http://' : 'https://') + input);
    }
  } catch {
    return { error: 'That does not look like a valid URL.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: 'Use an http:// or https:// URL.' };
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) {
    return { error: 'Use https:// for a public server — an access token over http is unsafe.' };
  }
  if (parsed.username || parsed.password) return { error: 'Remove the user:pass@ part from the URL.' };

  // A token typed into the field wins; otherwise keep one already in the URL.
  const token = rawToken.trim() || parsed.searchParams.get('token') || '';
  // Force root: origin drops any pathname/query/hash, so the token can only
  // land on `<origin>/`, never a deeper path or a different host.
  const base = new URL('/', parsed.origin);
  if (token) base.searchParams.set('token', token);
  return { href: base.toString() };
}
