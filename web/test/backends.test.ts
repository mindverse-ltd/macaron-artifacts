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

test('failed persistence keeps the legacy key so the next load retries migration', async () => {
  const ls = installLocalStorage({ macaron_auth_token: 'legacy-abc' });
  const { backends, auth } = await freshModules();
  ls.failWrites = true;
  // Migration still surfaces the token in-memory this run, but must NOT delete
  // the legacy key when the seeded list couldn't be persisted.
  assert.equal(auth.getToken(), 'legacy-abc');
  assert.equal(localStorage.getItem('macaron_auth_token'), 'legacy-abc');
  // Storage recovers, and a fresh page load (cache reset) re-reads storage → the
  // migration completes and the legacy key is removed.
  ls.failWrites = false;
  backends.__resetForTests();
  assert.equal(backends.getActiveBackend().token, 'legacy-abc');
  assert.equal(localStorage.getItem('macaron_auth_token'), null);
});

test('explicit clear during a write failure still invalidates the legacy source', async () => {
  // Regression (fail → clear → recover): if the registry write fails but the
  // user explicitly clears the token, the legacy key must be dropped anyway, so
  // a later successful load can't re-migrate and resurrect the cleared token.
  const ls = installLocalStorage({ macaron_auth_token: 'legacy-abc' });
  const { backends, auth } = await freshModules();
  ls.failWrites = true;           // registry can't persist...
  auth.clearToken();              // ...but the user explicitly clears
  assert.equal(localStorage.getItem('macaron_auth_token'), null);
  // Storage recovers and the page reloads: token stays cleared, not re-migrated.
  ls.failWrites = false;
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

  ls.failWrites = true;      // storage goes read-only...
  auth.clearToken();         // ...user (or a 401) clears the token
  // Immediately effective this session despite the failed write — NOT read back
  // from the still-stale persisted registry.
  assert.equal(auth.getToken(), '');
  assert.equal(backends.getActiveBackend().token, undefined);

  ls.failWrites = false;     // storage recovers
  auth.clearToken();         // a subsequent clear now persists
  backends.__resetForTests();  // simulate a reload: re-read from storage
  assert.equal(auth.getToken(), '');
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
