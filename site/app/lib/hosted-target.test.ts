import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedTarget } from './hosted-target.ts';

// hostedTarget turns buildTarget's `<origin>/?token=` into the same-origin
// hosted-route URL. It must: pick /app vs /app/codex by engine, carry the
// server as an encoded ?server=<origin> (no trailing slash, no path), keep the
// token when present and drop it when absent, and never emit an absolute URL
// (staying on the docs origin is the whole point of hosting vs redirecting).

test('claude engine → /app with encoded server + token', () => {
  assert.equal(hostedTarget('http://localhost:7878/?token=t', 'claude'), '/app?server=http%3A%2F%2Flocalhost%3A7878&token=t');
});

test('codex engine → /app/codex', () => {
  assert.equal(hostedTarget('http://localhost:7979/?token=t', 'codex'), '/app/codex?server=http%3A%2F%2Flocalhost%3A7979&token=t');
});

test('no token → server only, no token param', () => {
  assert.equal(hostedTarget('https://x.trycloudflare.com/', 'claude'), '/app?server=https%3A%2F%2Fx.trycloudflare.com');
});

test('server is the ORIGIN only — any path/query on the input is dropped', () => {
  // buildTarget already forces root, but hostedTarget must not re-introduce a path.
  assert.equal(hostedTarget('https://tunnel.test/?token=abc', 'claude'), '/app?server=https%3A%2F%2Ftunnel.test&token=abc');
});

test('always relative — never an absolute URL to the server origin', () => {
  const href = hostedTarget('https://tunnel.test/?token=abc', 'codex');
  assert.ok(href.startsWith('/app/codex?'), href);
  assert.ok(!/^https?:/i.test(href));
});
