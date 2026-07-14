import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTarget } from './connect-target.ts';

// Table-driven coverage of every normalization branch: bare host (scheme
// inferred by host), https + path/query/hash forced to root, http allowed only
// for local hosts, other schemes / userinfo rejected, token from field vs URL,
// and token encoding. Extends PR #144's gate with the http-localhost case.
const cases: Array<{ name: string; url: string; token: string; expect: { href: string } | { error: true } }> = [
  // bare host → scheme inferred
  { name: 'bare public host → https + field token', url: 'x.trycloudflare.com', token: 'tok9', expect: { href: 'https://x.trycloudflare.com/?token=tok9' } },
  { name: 'bare public host, no token', url: 'x.trycloudflare.com', token: '', expect: { href: 'https://x.trycloudflare.com/' } },
  { name: 'bare localhost:port → http (the local case)', url: 'localhost:7878', token: 'lt', expect: { href: 'http://localhost:7878/?token=lt' } },
  { name: 'bare 127.0.0.1 → http', url: '127.0.0.1:7979', token: '', expect: { href: 'http://127.0.0.1:7979/' } },
  { name: 'bare 192.168 LAN host → http', url: '192.168.1.50:7878', token: 'k', expect: { href: 'http://192.168.1.50:7878/?token=k' } },
  // explicit https
  { name: 'https root + url token kept', url: 'https://x.trycloudflare.com/?token=abc123', token: '', expect: { href: 'https://x.trycloudflare.com/?token=abc123' } },
  { name: 'https + deep path is forced to root', url: 'https://tunnel.test/deep/path?token=url-token', token: '', expect: { href: 'https://tunnel.test/?token=url-token' } },
  { name: 'https + path + hash dropped', url: 'https://tunnel.test/a/b#frag', token: 'k', expect: { href: 'https://tunnel.test/?token=k' } },
  { name: 'field token overrides url token', url: 'https://x.test/?token=inurl', token: 'field-wins', expect: { href: 'https://x.test/?token=field-wins' } },
  { name: 'token is url-encoded', url: 'https://x.test/', token: 'a b/c+d', expect: { href: 'https://x.test/?token=a+b%2Fc%2Bd' } },
  // explicit http: local ok, public rejected
  { name: 'explicit http://localhost is allowed', url: 'http://localhost:7878/?token=abc', token: '', expect: { href: 'http://localhost:7878/?token=abc' } },
  { name: 'explicit http://127.0.0.1 is allowed', url: 'http://127.0.0.1:7878/', token: 't', expect: { href: 'http://127.0.0.1:7878/?token=t' } },
  { name: 'http to a PUBLIC host is rejected', url: 'http://x.test/?token=abc', token: '', expect: { error: true } },
  // other schemes / userinfo / junk
  { name: 'ftp scheme is rejected (not treated as bare host)', url: 'ftp://tunnel.test/share?token=url-token', token: '', expect: { error: true } },
  { name: 'ws scheme is rejected', url: 'ws://tunnel.test/', token: '', expect: { error: true } },
  { name: 'userinfo is rejected', url: 'https://user:pass@tunnel.test/path?token=url-token', token: '', expect: { error: true } },
  { name: 'username-only is rejected', url: 'https://user@tunnel.test/', token: '', expect: { error: true } },
  { name: 'empty input is rejected', url: '', token: '', expect: { error: true } },
  { name: 'whitespace-only input is rejected', url: '   ', token: '', expect: { error: true } },
  { name: 'garbage is rejected', url: 'not a url ::::', token: 'x', expect: { error: true } },
];

for (const c of cases) {
  test(c.name, () => {
    const r = buildTarget(c.url, c.token);
    if ('error' in c.expect) {
      assert.ok('error' in r, `expected an error for ${JSON.stringify(c.url)}, got ${JSON.stringify(r)}`);
    } else {
      assert.deepEqual(r, c.expect);
    }
  });
}
