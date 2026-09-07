import type { Route } from './+types/connect';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { baseOptions } from '@/lib/layout.shared';
import { submit, onRestore } from '@/lib/connect-state';
import { HANDOFF_KEY, type Engine } from '@/lib/hosted-target';
import { track } from '@/lib/telemetry';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Connect · Macaron' },
    { name: 'description', content: 'Open a Macaron WebUI running on your machine or behind a public tunnel.' },
  ];
}

export default function Connect() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [engine, setEngine] = useState<Engine>('claude');

  // If the browser restores this page from the BFCache after a Back (e.g. the
  // user opened the WebUI then navigated back), wipe any token that the cached
  // DOM would otherwise show.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) { const s = onRestore({ url, token, error }); setUrl(s.url); setToken(s.token); }
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [url, token, error]);

  const go = () => {
    const { state, navigate, handoff } = submit(url, token, window.location.origin, engine);
    setUrl(state.url);
    setToken(state.token);
    setError(state.error);
    track('connect_submit', { engine, ok: !!navigate, hasToken: !!token });
    if (navigate && handoff) {
      // Stash the {server, token} in sessionStorage (same tab, same origin) and
      // open the clean hosted route — the credential never rides the URL, so it
      // can't leak into the document GET / access logs / referrers. The hosted
      // SPA reads and clears it on load.
      try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* private mode */ }
      window.location.assign(navigate);
    }
  };

  return (
    <HomeLayout {...baseOptions()}>
      <div className="site:p-4 site:flex site:flex-col site:items-center site:justify-center site:text-center site:flex-1">
        <div className="site:w-full site:max-w-md site:text-left">
          <h1 className="site:text-xl site:font-bold site:mb-1 site:text-center">Connect to a Macaron server</h1>
          <p className="site:text-fd-muted-foreground site:mb-6 site:text-center site:text-sm">
            Start a Macaron server on your machine, then paste its URL here to open its WebUI on this device.
          </p>

          <label className="site:block site:text-sm site:font-medium site:mb-1">Interface</label>
          <div className="site:grid site:grid-cols-3 site:gap-2 site:mb-4">
            {(['claude', 'codex', 'kimi'] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => { setEngine(e); track('tab_switch', { group: 'connect-engine', value: e }); }}
                className={`site:rounded-md site:border site:px-3 site:py-2 site:text-sm site:font-medium site:transition-colors ${engine === e ? 'site:border-fd-primary site:bg-fd-primary/10 site:text-fd-primary' : 'site:border-fd-border site:text-fd-muted-foreground site:hovered:bg-fd-accent'}`}
              >
                {e === 'claude' ? 'Claude Code' : e === 'codex' ? 'Codex' : 'Kimi Code'}
              </button>
            ))}
          </div>

          <label className="site:block site:text-sm site:font-medium site:mb-1">Server URL</label>
          <input
            className="site:w-full site:rounded-md site:border site:border-fd-border site:bg-fd-background site:px-3 site:py-2 site:text-sm site:mb-1"
            placeholder="localhost:7878  ·  https://xxxx.trycloudflare.com/?token=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
            autoFocus
          />
          <p className="site:text-xs site:text-fd-muted-foreground site:mb-4">
            Local server defaults: Claude on <code>localhost:7878</code>, Codex on <code>localhost:7979</code>, Kimi on <code>localhost:7980</code>.
          </p>

          <label className="site:block site:text-sm site:font-medium site:mb-1">Access token <span className="site:text-fd-muted-foreground site:font-normal">(optional if the link already has one)</span></label>
          <input
            className="site:w-full site:rounded-md site:border site:border-fd-border site:bg-fd-background site:px-3 site:py-2 site:text-sm site:mb-4"
            placeholder="token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          />

          {error && <p className="site:text-sm site:text-fd-destructive site:mb-4">{error}</p>}

          <button
            type="button"
            className="site:w-full site:inline-flex site:items-center site:justify-center site:gap-2 site:text-sm site:bg-fd-primary site:text-fd-primary-foreground site:rounded-full site:font-medium site:px-4 site:py-2.5"
            onClick={go}
          >
            Open WebUI <ArrowRight className="site:size-4" />
          </button>

          <p className="site:text-xs site:text-fd-muted-foreground site:mt-4 site:text-center">
            The WebUI runs here and talks directly to the server you name — your token is bound to that server, never put in the URL, and never stored on this site.
          </p>
          <p className="site:text-xs site:text-fd-muted-foreground site:mt-2 site:text-center">
            Your server must allow this origin: start it with{' '}
            <code>MACARON_ALLOWED_ORIGINS={typeof window !== 'undefined' ? window.location.origin : 'https://artifacts.macaron.im'}</code>. It then requires an access token for cross-origin requests — set <code>MACARON_AUTH_TOKEN</code> or copy the one it prints on start.
          </p>
        </div>
      </div>
    </HomeLayout>
  );
}
