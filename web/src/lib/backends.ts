// Backend registry for the WebUI. A "backend" is one headless macaron server the
// UI can talk to. The list lives entirely in localStorage — the servers are
// stateless and don't know about each other; picking which one to drive is a
// pure client concern (like VS Code's remote picker).
//
// This module is step 1 of the multi-backend split (MAC-8578): just the data
// model + per-backend token storage + a one-time migration off the old single
// global token. The switcher UI, health probing, and CORS are deliberately NOT
// here. Local default behavior must stay byte-for-byte the same: the built-in
// LOCAL backend has an empty baseUrl, so requests keep hitting same-origin
// relative /api paths exactly as before.

export type Backend = {
  id: string;
  label: string;
  // '' means same-origin (the local default). Otherwise an absolute origin like
  // https://box.example.com — no trailing slash, no path.
  baseUrl: string;
  token?: string;
};

export const LOCAL_BACKEND_ID = 'local';

const BACKENDS_KEY = 'macaron_backends';
const ACTIVE_KEY = 'macaron_active_backend';
// The pre-multi-backend single global token. Read once during migration, then
// deleted so a later clearToken() can't be undone by a re-migration (if the
// backend list is ever reset, the stale legacy token must not resurrect).
const LEGACY_TOKEN_KEY = 'macaron_auth_token';

function localDefault(): Backend {
  return { id: LOCAL_BACKEND_ID, label: 'Local', baseUrl: '' };
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; /* private mode / quota */ }
}

// In-memory authoritative copy of the backend list. localStorage writes can fail
// (private mode / quota), so we can't re-read the list from storage every call —
// a failed clearToken() would keep reading back the stale persisted token. This
// cache is the source of truth for the session; storage is best-effort mirror.
let cache: Backend[] | null = null;
// `dirty` = the cache hasn't been persisted yet (a write failed). `pendingLegacyRemoval`
// = a migrated legacy key still needs deleting once the seeded list is persisted.
// Both are retried by flush() on the next operation, so once storage recovers the
// cleared / migrated state persists WITHOUT the caller having to act again.
let dirty = false;
let pendingLegacyRemoval = false;

// Retry any deferred persistence. Order matters: persist the registry first, and
// only drop the legacy key once the (cleared / migrated) registry is safely
// written — otherwise a crash between the two would lose the token entirely.
function flush(): void {
  if (dirty && cache) {
    if (write(BACKENDS_KEY, cache)) {
      dirty = false;
    } else if (!cache.some((b) => b.token)) {
      // Persistence fallback: the write failed but the cache holds no token, so it
      // is equivalent to the clean LOCAL backend a reload would re-seed. Drop any
      // stale persisted registry (removeItem can succeed under quota pressure where
      // setItem can't) so a reload before storage recovers can't read a stale token
      // back — even if the caller never calls loadBackends() again first.
      try { localStorage.removeItem(BACKENDS_KEY); dirty = false; } catch { return; }
    } else {
      return; // a token-bearing write we couldn't persist — keep retrying, keep legacy
    }
  }
  if (!dirty && pendingLegacyRemoval) {
    try { localStorage.removeItem(LEGACY_TOKEN_KEY); pendingLegacyRemoval = false; } catch { /* retry next time */ }
  }
}

// Load the backend list, seeding + migrating on first run. Always returns at
// least the built-in LOCAL backend, and guarantees LOCAL is present even if a
// stored list somehow dropped it.
export function loadBackends(): Backend[] {
  if (cache) { flush(); return cache; }
  const stored = read<Backend[]>(BACKENDS_KEY);
  if (stored && Array.isArray(stored) && stored.length > 0) {
    cache = stored.some((b) => b.id === LOCAL_BACKEND_ID) ? stored : [localDefault(), ...stored];
    // A persisted registry means migration already happened; any leftover legacy
    // key is stale (a previous removal must have failed). Reconcile it here so a
    // later registry reset can't re-migrate and resurrect the old token.
    try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* ignore */ }
    return cache;
  }
  // First run on a multi-backend build: fold any legacy single token into the
  // local backend so a remembered share-link/tunnel token keeps working. The
  // legacy key is only removed once the seeded list is confirmed persisted (via
  // flush) — else a failed write (private mode / quota) would drop the token with
  // nothing to re-migrate from. A failed persist leaves dirty + pendingLegacyRemoval
  // set, so the next operation after storage recovers completes the migration.
  const local = localDefault();
  let legacy = '';
  try { legacy = localStorage.getItem(LEGACY_TOKEN_KEY) || ''; } catch { /* ignore */ }
  if (legacy) { local.token = legacy; pendingLegacyRemoval = true; }
  cache = [local];
  dirty = true;
  flush();
  return cache;
}

// Update the in-memory source of truth first, then best-effort mirror to
// storage. The cache update is what makes an explicit / 401 clear stick even
// when the write fails; `dirty` gets retried by flush() once storage recovers.
export function saveBackends(list: Backend[]): void {
  cache = list;
  dirty = true;
  flush();
}

// Test-only: drop the in-memory cache + deferred-write state so the next
// loadBackends() re-reads storage, simulating a fresh page load. Never in prod.
export function __resetForTests(): void {
  cache = null;
  dirty = false;
  pendingLegacyRemoval = false;
}

export function getActiveBackendId(): string {
  try { return localStorage.getItem(ACTIVE_KEY) || LOCAL_BACKEND_ID; } catch { return LOCAL_BACKEND_ID; }
}

export function setActiveBackendId(id: string): void {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private mode */ }
}

export function getActiveBackend(): Backend {
  const list = loadBackends();
  const id = getActiveBackendId();
  return list.find((b) => b.id === id) || list.find((b) => b.id === LOCAL_BACKEND_ID) || localDefault();
}

// Persist a token against the active backend (used by the login flow). Writing
// an empty string clears it. This replaces the old single-key token storage.
export function setActiveBackendToken(token: string): void {
  const list = loadBackends();
  const id = getActiveBackendId();
  const next = list.map((b) => (b.id === id ? { ...b, token: token || undefined } : b));
  // If the active id isn't in the list (shouldn't happen), fall back to LOCAL.
  if (!next.some((b) => b.id === id)) {
    const i = next.findIndex((b) => b.id === LOCAL_BACKEND_ID);
    if (i >= 0) next[i] = { ...next[i], token: token || undefined };
  }
  // Explicitly clearing the LOCAL token must also invalidate the legacy source,
  // even if the registry write below fails (private mode / quota): otherwise the
  // next loadBackends() would re-migrate the stale legacy token and resurrect a
  // token the user just cleared. Defer via pendingLegacyRemoval so flush() retries
  // it (after the cleared registry persists) once storage recovers.
  if (!token && (id === LOCAL_BACKEND_ID || !list.some((b) => b.id === id))) {
    pendingLegacyRemoval = true;
  }
  saveBackends(next);
}
