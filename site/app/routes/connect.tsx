import type { Route } from './+types/connect';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { baseOptions } from '@/lib/layout.shared';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Connect · Macaron' },
    { name: 'description', content: 'Open a Macaron WebUI running behind a public tunnel.' },
  ];
}

// Pure jump gate: takes a tunnel URL (optionally already carrying ?token=) plus
// an optional token, normalizes them into `<origin>/?token=<t>`, and hands off
// via a full navigation. artifacts NEVER stores the token, calls the API, or
// touches the data plane — the destination SPA is same-origin with the tunnel
// and owns all of that. This page only redirects.
function buildTarget(rawUrl: string, rawToken: string): { href: string } | { error: string } {
  const url = rawUrl.trim();
  if (!url) return { error: 'Paste the tunnel URL first.' };
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return { error: 'That does not look like a valid URL.' };
  }
  if (parsed.protocol !== 'https:') return { error: 'Use the https:// tunnel URL — an access token over http is unsafe.' };
  // A token typed into the field wins; otherwise keep one already in the URL.
  const token = rawToken.trim() || parsed.searchParams.get('token') || '';
  parsed.search = '';
  parsed.hash = '';
  const base = parsed.toString().replace(/\/$/, '');
  return { href: token ? `${base}/?token=${encodeURIComponent(token)}` : `${base}/` };
}

export default function Connect() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  const go = () => {
    const r = buildTarget(url, token);
    if ('error' in r) { setError(r.error); return; }
    setError('');
    window.location.assign(r.href); // full navigation to the same-origin SPA — no token kept here
  };

  return (
    <HomeLayout {...baseOptions()}>
      <div className="p-4 flex flex-col items-center justify-center text-center flex-1">
        <div className="w-full max-w-md text-left">
          <h1 className="text-xl font-bold mb-1 text-center">Connect to a session</h1>
          <p className="text-fd-muted-foreground mb-6 text-center text-sm">
            Start a tunnel from the Macaron WebUI, then paste its share link here to open it on this device.
          </p>

          <label className="block text-sm font-medium mb-1">Tunnel URL</label>
          <input
            className="w-full rounded-md border border-fd-border bg-fd-background px-3 py-2 text-sm mb-4"
            placeholder="https://xxxx.trycloudflare.com/?token=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
            autoFocus
          />

          <label className="block text-sm font-medium mb-1">Access token <span className="text-fd-muted-foreground font-normal">(optional if the link already has one)</span></label>
          <input
            className="w-full rounded-md border border-fd-border bg-fd-background px-3 py-2 text-sm mb-4"
            placeholder="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          />

          {error && <p className="text-sm text-fd-destructive mb-4">{error}</p>}

          <button
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 text-sm bg-fd-primary text-fd-primary-foreground rounded-full font-medium px-4 py-2.5"
            onClick={go}
          >
            Open session <ArrowRight className="size-4" />
          </button>

          <p className="text-xs text-fd-muted-foreground mt-4 text-center">
            This page only redirects — your token is never stored here and never leaves your browser except in the link you open.
          </p>
        </div>
      </div>
    </HomeLayout>
  );
}
