import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

// Minimal localStorage shim so the browser-facing modules run under node --test.
// Returns a handle whose `failWrites` flag makes setItem throw (private mode /
// quota), so migration-persistence failures are testable.
function installLocalStorage(seed: Record<string, string> = {}): { failWrites: boolean } {
  const store = new Map<string, string>(Object.entries(seed));
  const ctl = { failWrites: false };
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { if (ctl.failWrites) throw new Error('QuotaExceeded'); store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
  return ctl;
}

// auth.ts imports backends.ts internally, so both must resolve to the SAME
// module instance for the in-memory cache to be shared (as it is in the browser).
// Import without a query string and reset the cache per test instead of busting
// the ESM cache — that reset simulates a fresh page load.
async function freshModules() {
  const backends = await import('../src/lib/backends.ts');
  const auth = await import('../src/lib/auth.ts');
  backends.__resetForTests();
  return { backends, auth };
}

const origLS = (globalThis as { localStorage?: Storage }).localStorage;
afterEach(() => { (globalThis as { localStorage?: Storage }).localStorage = origLS; });

test('fresh install seeds a single LOCAL backend with empty baseUrl', async () => {
  installLocalStorage();
  const { backends } = await freshModules();
  const list = backends.loadBackends();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, backends.LOCAL_BACKEND_ID);
  assert.equal(list[0].baseUrl, '');
  assert.equal(backends.getActiveBackendId(), backends.LOCAL_BACKEND_ID);
});

test('legacy single token migrates onto the LOCAL backend', async () => {
  installLocalStorage({ macaron_auth_token: 'legacy-abc' });
  const { backends, auth } = await freshModules();
  assert.equal(backends.getActiveBackend().token, 'legacy-abc');
  // The auth facade reads through to the active backend.
  assert.equal(auth.getToken(), 'legacy-abc');
  // The legacy key is consumed (deleted) so it can't re-migrate later.
  assert.equal(localStorage.getItem('macaron_auth_token'), null);
});

test('cleared token stays cleared even if the backend list is reset', async () => {
  // Regression: migration must delete the legacy key, else clearToken() gets
  // undone by a re-migration when the backend list is later dropped.
  installLocalStorage({ macaron_auth_token: 'legacy-abc' });
  const { backends, auth } = await freshModules();
  auth.clearToken();
  assert.equal(auth.getToken(), '');
  // Simulate the backend list being wiped AND the page reloaded (cache dropped):
  localStorage.removeItem('macaron_backends');
  backends.__resetForTests();
  // Re-seeding must NOT resurrect the legacy token.
  assert.equal(backends.getActiveBackend().token, undefined);
  assert.equal(auth.getToken(), '');
});

test('failed migration is retried automatically once storage recovers', async () => {
  const ls = installLocalStorage({ macaron_auth_token: 'legacy-abc' });
  const { backends, auth } = await freshModules();
  ls.failWrites = true;
  // Migration surfaces the token in-memory this run, but must NOT delete the
  // legacy key while the seeded list can't be persisted.
  assert.equal(auth.getToken(), 'legacy-abc');
  assert.equal(localStorage.getItem('macaron_auth_token'), 'legacy-abc');
  // Storage recovers: the next operation flushes the deferred migration in this
  // same session — the seeded registry persists and the legacy key is removed,
  // WITHOUT waiting for a reload.
  ls.failWrites = false;
  backends.loadBackends();
  assert.equal(localStorage.getItem('macaron_auth_token'), null);
  const persisted = JSON.parse(localStorage.getItem('macaron_backends')!) as Array<{ token?: string }>;
  assert.equal(persisted[0].token, 'legacy-abc');
  // A fresh reload reads the migrated registry back; the old key does not re-migrate.
  backends.__resetForTests();
  assert.equal(backends.getActiveBackend().token, 'legacy-abc');
  assert.equal(localStorage.getItem('macaron_auth_token'), null);
});

test('explicit clear during a write failure invalidates the legacy source on recovery', async () => {
  // fail → clear → recover: a clear during a write-failure window takes effect
  // in-memory immediately, and the legacy key is dropped automatically once
  // storage recovers — WITHOUT the caller having to clear a second time.
  const ls = installLocalStorage({ macaron_auth_token: 'legacy-abc' });
  const { backends, auth } = await freshModules();
  ls.failWrites = true;           // registry can't persist...
  auth.clearToken();              // ...but the user explicitly clears
  // In-memory clear is authoritative even before the legacy key can be removed.
  assert.equal(auth.getToken(), '');
  assert.equal(backends.getActiveBackend().token, undefined);
  // Storage recovers: the very next operation flushes the deferred removal —
  // no second clearToken() needed.
  ls.failWrites = false;
  backends.loadBackends();
  assert.equal(localStorage.getItem('macaron_auth_token'), null);
  // And a fresh reload after that stays cleared, not re-migrated.
  localStorage.removeItem('macaron_backends');
  backends.__resetForTests();
  assert.equal(backends.getActiveBackend().token, undefined);
  assert.equal(auth.getToken(), '');
});

test('persisted registry → fail writes → clear → recover: clear sticks immediately and persists', async () => {
  // The token lives in an already-persisted registry (no legacy key involved).
  // A clear during a write-failure window must take effect for the rest of the
  // session (in-memory authoritative), and once storage recovers the cleared
  // state must persist across a reload rather than reading back the old token.
  const persisted = JSON.stringify([{ id: 'local', label: 'Local', baseUrl: '', token: 'persisted-tok' }]);
  const ls = installLocalStorage({ macaron_backends: persisted });
  const { backends, auth } = await freshModules();
  assert.equal(auth.getToken(), 'persisted-tok');

  ls.failWrites = true;      // storage goes read-only (setItem throws)...
  auth.clearToken();         // ...user (or a 401) clears the token
  // Immediately effective this session despite the failed setItem — NOT read back
  // from the still-stale persisted registry.
  assert.equal(auth.getToken(), '');
  assert.equal(backends.getActiveBackend().token, undefined);
  // Persistence fallback: since the cleared cache holds no token, the stale
  // registry is removed right away (removeItem works even when setItem is failing),
  // so the cleared state is durable even without waiting for storage to recover.
  assert.equal(localStorage.getItem('macaron_backends'), null);

  ls.failWrites = false;     // storage recovers
  // A reload reads no registry back and re-seeds a clean LOCAL — old token gone.
  backends.__resetForTests();
  assert.equal(auth.getToken(), '');
  assert.equal(backends.getActiveBackend().token, undefined);
});

test('clear during write failure survives a direct reload without a prior loadBackends()', async () => {
  // Persistence-fallback gap: after clearing during a failed write, the caller
  // may reload immediately (no further loadBackends() to flush). The stale
  // registry must already be gone, so the reload can't read the old token back.
  const persisted = JSON.stringify([{ id: 'local', label: 'Local', baseUrl: '', token: 'persisted-tok' }]);
  const ls = installLocalStorage({ macaron_backends: persisted });
  const { backends, auth } = await freshModules();
  ls.failWrites = true;
  auth.clearToken();
  // Straight to reload — nothing else called in between.
  backends.__resetForTests();
  assert.equal(auth.getToken(), '');
  assert.equal(backends.getActiveBackend().token, undefined);
});

test('registry persisted but legacy removal failed: reload reconciles, reset does not re-migrate', async () => {
  // The registry write succeeds while the legacy-key removal fails, leaving a
  // stale legacy key behind. Loading the persisted registry must reconcile it
  // (delete the leftover), so a later registry reset can't re-migrate the token.
  const migrated = JSON.stringify([{ id: 'local', label: 'Local', baseUrl: '', token: 'migrated-tok' }]);
  installLocalStorage({ macaron_backends: migrated, macaron_auth_token: 'legacy-abc' });
  const { backends } = await freshModules();
  // First load reads the persisted registry and reconciles the stale legacy key.
  assert.equal(backends.getActiveBackend().token, 'migrated-tok');
  assert.equal(localStorage.getItem('macaron_auth_token'), null);
  // Even if the registry is later wiped, there's nothing left to re-migrate.
  localStorage.removeItem('macaron_backends');
  backends.__resetForTests();
  assert.equal(backends.getActiveBackend().token, undefined);
});

test('no legacy token → LOCAL backend has no token', async () => {
  installLocalStorage();
  const { auth } = await freshModules();
  assert.equal(auth.getToken(), '');
});

test('setToken / clearToken write to the active backend', async () => {
  installLocalStorage();
  const { backends, auth } = await freshModules();
  auth.setToken('tok-1');
  assert.equal(backends.getActiveBackend().token, 'tok-1');
  assert.equal(auth.getToken(), 'tok-1');
  auth.clearToken();
  assert.equal(backends.getActiveBackend().token, undefined);
  assert.equal(auth.getToken(), '');
});

test('apiUrl leaves relative paths untouched for the local default', async () => {
  installLocalStorage();
  const { auth } = await freshModules();
  assert.equal(auth.apiUrl('/api/health'), '/api/health');
});

test('apiUrl prefixes the active backend baseUrl; absolute URLs pass through', async () => {
  installLocalStorage();
  const { backends, auth } = await freshModules();
  backends.saveBackends([
    { id: backends.LOCAL_BACKEND_ID, label: 'Local', baseUrl: '' },
    { id: 'remote', label: 'Box', baseUrl: 'https://box.example.com', token: 'rt' },
  ]);
  backends.setActiveBackendId('remote');
  assert.equal(auth.apiUrl('/api/health'), 'https://box.example.com/api/health');
  assert.equal(auth.apiUrl('https://other.test/x'), 'https://other.test/x');
  assert.equal(auth.getToken(), 'rt');
});

test('authHeaders reflects the active backend token', async () => {
  installLocalStorage();
  const { auth } = await freshModules();
  assert.deepEqual(auth.authHeaders(), {});
  auth.setToken('h1');
  assert.deepEqual(auth.authHeaders(), { Authorization: 'Bearer h1' });
});
