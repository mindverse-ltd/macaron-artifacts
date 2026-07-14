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
// A persisted tombstone recording a legacy value we've decided is DEAD. The
// in-memory `retiredLegacyToken` is lost on a real page reload, so if the legacy
// key removal PERMANENTLY fails, the next process would re-absorb the still-present
// dead key. This key survives reload and lets hydrate() refuse that value by value.
// Removed the instant the legacy key is confirmed gone (its job is done).
const LEGACY_TOMBSTONE_KEY = 'macaron_auth_token_retired';

function localDefault(): Backend {
  return { id: LOCAL_BACKEND_ID, label: 'Local', baseUrl: '' };
}

// Pure parse of a stored registry string into a LOCAL-bearing list — NO storage side effects
// (unlike hydrate, which also mutates cache / legacy state). Used by the intent-replay path in
// flush() to re-read the freshest raw without re-entering hydrate → flush.
function parseRegistry(raw: string | null): Backend[] {
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  const stored = Array.isArray(parsed) ? parsed.filter((b): b is Backend => !!b && typeof (b as Backend).id === 'string') : null;
  if (stored && stored.some((b) => b.id === LOCAL_BACKEND_ID)) return stored;
  return stored ? [localDefault(), ...stored] : [localDefault()];
}

// Read the raw registry string. `ok: false` means the read itself threw (private
// mode SecurityError) — distinct from a real absent key (`ok: true, raw: null`),
// which is what another tab deleting the registry looks like. Conflating the two
// would let a SecurityError reset a good in-memory cache to a tokenless LOCAL.
function readRegistryRaw(): { ok: boolean; raw: string | null } {
  try { return { ok: true, raw: localStorage.getItem(BACKENDS_KEY) }; }
  catch { return { ok: false, raw: null }; }
}

// Read the legacy key, distinguishing a real value / absence (`ok: true`) from a
// read that threw (`ok: false`). A thrown read is NOT a deletion — treating it as
// one would drop a LOCAL token whose only backing is the legacy key.
function readLegacyRaw(): { ok: boolean; value: string } {
  try { return { ok: true, value: localStorage.getItem(LEGACY_TOKEN_KEY) || '' }; }
  catch { return { ok: false, value: '' }; }
}

function readLegacy(): string { return readLegacyRaw().value; }

// The persisted retirement tombstone (a legacy value known dead). `ok:false` means the
// read THREW — distinct from a real absent tombstone (`ok:true, value:''`). The two must
// not be conflated: an absent tombstone means "not retired, safe to migrate", but a thrown
// read means retirement is UNKNOWN — migrating then would resurrect a value we can't verify.
function readTombstone(): { ok: boolean; value: string } {
  try { return { ok: true, value: localStorage.getItem(LEGACY_TOMBSTONE_KEY) || '' }; }
  catch { return { ok: false, value: '' }; }
}

function writeTombstone(value: string): boolean {
  try { localStorage.setItem(LEGACY_TOMBSTONE_KEY, value); return true; } catch { return false; }
}

// The persisted shape of the registry. The default LOCAL backend is synthetic —
// it's always re-seeded on load — so it needn't be stored. Omitting it keeps the
// stored registry in its ORIGINAL shape (a REMOTE-only list stays REMOTE-only),
// which is what lets a REMOTE token clear only ever SHRINK the stored value and
// therefore persist even under a full quota. A LOCAL that carries a token or
// non-default config is real state and is kept — UNLESS its token is `redundantLocalToken`
// (the still-present legacy key backs it), in which case it's droppable too: reload
// reconstructs LOCAL from the legacy key, so stripping it here loses nothing.
function toStored(list: Backend[], redundantLocalToken?: string): Backend[] {
  return list.filter((b) => {
    if (b.id !== LOCAL_BACKEND_ID) return true;
    if (!(b.label === 'Local' && b.baseUrl === '')) return true; // non-default LOCAL is real config
    if (!b.token) return false;                                  // tokenless default LOCAL: strip
    if (redundantLocalToken && b.token === redundantLocalToken) return false; // backed by legacy key: strip
    return true;
  });
}

function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; /* private mode / quota */ }
}

// Set/clear a backend's token, mirroring the login flow: target the active id,
// falling back to LOCAL if it somehow isn't in the list. Pure — returns a new list.
function applyToken(list: Backend[], id: string, token: string | undefined): Backend[] {
  const next = list.map((b) => (b.id === id ? { ...b, token: token || undefined } : b));
  if (!next.some((b) => b.id === id)) {
    const i = next.findIndex((b) => b.id === LOCAL_BACKEND_ID);
    if (i >= 0) next[i] = { ...next[i], token: token || undefined };
  }
  return next;
}

// In-memory authoritative copy of the backend list. localStorage writes can fail
// (private mode / quota), so we can't re-read the list from storage every call —
// a failed clearToken() would keep reading back the stale persisted token. This
// cache is the source of truth for the session; storage is best-effort mirror.
let cache: Backend[] | null = null;
// `cacheReconciled` = the cache reflects a SUCCESSFUL storage read (or a seed we
// then read back), so it's safe to overwrite storage with it. A cache built purely
// from a mutation made while storage was unreadable is NOT reconciled: overwriting
// the (present but unread) registry with it would drop backends we never saw.
let cacheReconciled = false;
// `dirty` = the cache hasn't been persisted yet (a write failed). `pendingLegacyRemoval`
// = a migrated legacy key still needs deleting once the seeded list is persisted.
// Both are retried by flush() on the next operation, so once storage recovers the
// cleared / migrated state persists WITHOUT the caller having to act again.
let dirty = false;
let pendingLegacyRemoval = false;
// When a still-present legacy key was folded into LOCAL's token, this holds that
// value. It makes LOCAL's token redundant for persistence (reload re-absorbs it
// from the legacy key), so toStored() can strip LOCAL and a REMOTE clear shrinks
// the stored value even under a full quota. Cleared once the legacy key is gone.
let legacyBackedLocalToken: string | undefined;
// A legacy token value we've decided is DEAD (explicitly cleared, or already folded
// into a persisted registry). Even if we can't delete the key right now, this value
// must never be re-absorbed onto LOCAL — not by a hydrate(null) after another tab
// wipes the registry, nor by any later reset. Retirement outlives the legacy key.
let retiredLegacyToken: string | undefined;
// The retired value still needs its durable tombstone written (the write failed under
// private mode / quota). Retried by flush() so the tombstone lands once storage recovers,
// before the legacy key is removed — otherwise a reload between the two resurrects the value.
let pendingTombstoneWrite = false;
// The raw registry string this module last read from / wrote to storage. Used to
// detect another tab clearing or reconfiguring a backend: if storage no longer
// matches what we last saw AND we have nothing unpersisted, adopt the newer value
// instead of clobbering it on the next save.
let lastSeenRaw: string | null = null;
// Token set/clear operations applied while storage was unreadable (no reconciled
// cache yet). They can't be persisted blind — doing so would clobber unseen state.
// On the next successful read they're REPLAYED onto the real registry, so the
// user's intent survives without overwriting backends we couldn't observe.
// `idResolved` = the active id was actually readable at call time; when false the id
// is only a guessed default and must be RE-READ against fresh storage at replay time.
let pendingMutations: Array<{ id: string; token: string | undefined; idResolved: boolean }> = [];
// Reconciled token intents whose persistence write FAILED (private mode / quota). Unlike a
// whole-list `dirty` flush — which would re-write the entire cached snapshot and roll back a
// concurrent cross-tab rename/add — these are replayed by re-hydrating the FRESHEST raw and
// re-applying only the one (id → token) change each names, so cross-tab edits survive.
let pendingIntents: Array<{ id: string; token: string | undefined }> = [];

// Retire a legacy value: mark it dead so it's never re-absorbed, and schedule the
// key for removal. Also persist a durable tombstone so the retirement survives a
// real page reload even if the legacy-key removal keeps failing — otherwise the
// next process, with no in-memory marker, would re-absorb the still-present key.
function retireLegacy(value: string | undefined): void {
  if (value) { retiredLegacyToken = value; if (!writeTombstone(value)) pendingTombstoneWrite = true; }
  legacyBackedLocalToken = undefined;
  pendingLegacyRemoval = true;
}

// Compare-and-swap removal of the legacy key, by value. Only delete when the key
// STILL holds the value we retired — if another tab wrote a NEW token there, that
// value was never retired and must survive (deleting it would drop a fresh login).
// Returns true when the retirement is settled (key gone, or no longer our value),
// so the caller can stop retrying. The tombstone outlives the key by one step: once
// the retired value is gone from the key, the tombstone's job is done — but only clear
// it when it STILL names OUR retired value. Another tab may have retired a DIFFERENT
// value and written its own tombstone Y; blindly removing it would resurrect Y's value.
function removeLegacyKey(expected: string | undefined): boolean {
  const cur = readLegacyRaw();
  if (!cur.ok) return false;                          // couldn't read → retry later
  if (expected && cur.value && cur.value !== expected) {
    // Another tab replaced the retired token with a live one. Our retirement no longer
    // applies; leave the key and drop the tombstone ONLY if it still names our (now
    // superseded) value — never a tombstone another tab wrote for a different value.
    dropTombstoneIfMatches(expected);
    return true;
  }
  if (cur.value) { try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { return false; } }
  dropTombstoneIfMatches(expected);
  return true;
}

// Remove the tombstone only when it still holds `expected` — the value WE retired. A
// mismatch means another tab retired a different value; leaving its tombstone intact keeps
// that value dead. A thrown read leaves the tombstone (harmless: an absent legacy key can't
// be re-absorbed, and a stale tombstone only ever blocks re-migration of a dead value).
function dropTombstoneIfMatches(expected: string | undefined): void {
  const t = readTombstone();
  if (!t.ok) return;
  if (!expected || t.value === expected || t.value === '') { try { localStorage.removeItem(LEGACY_TOMBSTONE_KEY); } catch { /* best-effort */ } }
}

// Retry any deferred persistence. Clearing a token only ever shrinks the registry,
// so its write succeeds under quota pressure; a write that still fails means storage
// is frozen (private mode), and the in-memory cache stays authoritative for the
// session. We never delete the whole registry as a fallback — that would drop
// tokenless REMOTE backends (their label/baseUrl are real config, not throwaway
// state). Order matters: persist the registry first, and only drop the legacy key
// once it's safely written, so a crash between the two can't lose the token.
function flush(): void {
  // Replay any single-backend intents whose write failed, by re-hydrating the freshest raw and
  // re-applying ONLY that backend's change. Doing this before the whole-list branch means a
  // concurrent cross-tab rename/add is preserved — we never re-write the whole stale snapshot.
  if (pendingIntents.length > 0) {
    const { ok, raw } = readRegistryRaw();
    if (ok) {
      const still: Array<{ id: string; token: string | undefined }> = [];
      for (const intent of pendingIntents) {
        const base = applyToken(parseRegistry(raw), intent.id, intent.token);
        const stored = toStored(base);
        if (write(BACKENDS_KEY, stored)) { cache = base; lastSeenRaw = JSON.stringify(stored); }
        else still.push(intent); // storage still frozen — retry next time
      }
      pendingIntents = still;
    }
  }
  // Only a cache reconciled with storage may overwrite it. An unreconciled cache
  // (a blind mutation during a read failure) stays pending until the next read
  // merges it — see loadBackends. We still process pendingLegacyRemoval below.
  if (dirty && cache && cacheReconciled) {
    // Prefer persisting the FULL registry: a legacy-backed LOCAL token becomes real
    // registry state, after which the legacy key is redundant — retire it so a later
    // reset can't roll back to the old token.
    const full = toStored(cache);
    if (write(BACKENDS_KEY, full)) {
      dirty = false;
      lastSeenRaw = JSON.stringify(full);
      if (legacyBackedLocalToken) retireLegacy(legacyBackedLocalToken);
    } else if (legacyBackedLocalToken && cache.some((b) => b.id === LOCAL_BACKEND_ID && b.token === legacyBackedLocalToken)) {
      // Quota-full fallback — ONLY while LOCAL genuinely still carries the legacy-backed
      // token. Persist a SHRUNK shape dropping that LOCAL: reload re-absorbs it from the
      // legacy key, so nothing is lost, and a later REMOTE clear only shrinks the stored
      // value. LOCAL's token now lives ONLY in the legacy key — KEEP it (cancel pending
      // removal). If LOCAL's token was since cleared/changed, this branch is skipped so
      // an explicit clear's legacy removal is NOT cancelled (the token must stay dead).
      const shrunk = toStored(cache, legacyBackedLocalToken);
      if (write(BACKENDS_KEY, shrunk)) { dirty = false; lastSeenRaw = JSON.stringify(shrunk); pendingLegacyRemoval = false; return; }
    }
  }
  if (pendingLegacyRemoval) {
    const localHasToken = !!cache?.find((b) => b.id === LOCAL_BACKEND_ID)?.token;
    const localBackedByLegacy = !!legacyBackedLocalToken && localHasToken;
    if (!localBackedByLegacy && (!dirty || !localHasToken || !!retiredLegacyToken)) {
      // Try to remove the legacy key. If it's gone, the value can't resurrect and the durable
      // tombstone is unnecessary — drop the pending write. If removal FAILS (key still present),
      // the tombstone is the ONLY thing guarding against re-migration on reload, so make sure it
      // lands: retry the write and keep retrying the whole retirement until one of them settles.
      if (removeLegacyKey(retiredLegacyToken)) { pendingLegacyRemoval = false; pendingTombstoneWrite = false; legacyBackedLocalToken = undefined; }
      else if (pendingTombstoneWrite && retiredLegacyToken && writeTombstone(retiredLegacyToken)) { pendingTombstoneWrite = false; }
    }
  }
}

// Reconcile the legacy key across tabs. When LOCAL's token is backed ONLY by the
// legacy key (a quota fallback stripped it from the persisted registry), the
// registry raw alone can't reflect another tab clearing or changing LOCAL by
// touching that key — so watch it directly. A read that THREW is not a deletion:
// leave the token in place. An empty value clears LOCAL; a changed value updates it.
function revalidateLegacy(): void {
  if (!legacyBackedLocalToken || !cache) return;
  const { ok, value } = readLegacyRaw();
  if (!ok) return;                              // SecurityError — not a delete
  if (value === legacyBackedLocalToken) return; // unchanged
  const nextToken = value || undefined;         // '' → cleared, other → updated
  cache = cache.map((b) => (b.id === LOCAL_BACKEND_ID && b.token === legacyBackedLocalToken ? { ...b, token: nextToken } : b));
  legacyBackedLocalToken = nextToken;
  dirty = true;
}

// Normalize a (possibly null / LOCAL-less / malformed) stored registry into the
// in-memory cache, always LOCAL-bearing. This is the single cold-load path: a fresh
// page load, an external delete, and another tab's reconfiguration all funnel through
// here from ONE raw read of storage, so raw and cache never disagree.
function hydrate(raw: string | null): Backend[] {
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  // Keep only well-formed entries — a hand-corrupted `[null]` / `[{}]` must not crash.
  const stored = Array.isArray(parsed) ? (parsed.filter((b): b is Backend => !!b && typeof (b as Backend).id === 'string')) : null;
  cacheReconciled = true;
  // Load any durable tombstone into the in-memory marker FIRST. On a real reload the
  // in-memory `retiredLegacyToken` is gone, so this is the only thing standing between
  // a permanently-undeletable dead legacy key and its resurrection below. A tombstone
  // read that THREW leaves retirement UNKNOWN — we must not migrate a legacy value we
  // can't verify is dead, so remember that to suppress the absorb branch.
  const tomb = readTombstone();
  if (tomb.value) retiredLegacyToken = tomb.value;
  const tombUnknown = !tomb.ok;
  if (stored && stored.length > 0 && stored.some((b) => b.id === LOCAL_BACKEND_ID)) {
    cache = stored;
    lastSeenRaw = raw;
    // A LOCAL-bearing registry is self-sufficient: LOCAL's token (if any) lives in the
    // registry, not the legacy key, so clear the marker — else a later quota fallback
    // could wrongly strip LOCAL as "legacy-backed" and lose the sole token. Any leftover
    // legacy key is stale — retire + remove it (retried every load via pendingLegacyRemoval
    // on failure) so a reset can't re-migrate the old token.
    legacyBackedLocalToken = undefined;
    const stale = readLegacyRaw();
    if (stale.ok && stale.value) retireLegacy(stale.value); // records tombstone + schedules removal
    if (pendingLegacyRemoval && removeLegacyKey(retiredLegacyToken)) { pendingLegacyRemoval = false; }
    return cache;
  }
  // No usable stored list, or one missing LOCAL: (re)build LOCAL. If a legacy token is
  // still present AND not retired, it was never migrated (no LOCAL ever held it), so
  // absorb it now — else a tokenless LOCAL would drop the sole credential. A RETIRED
  // legacy value is dead: never re-absorb it (that would resurrect a cleared token after
  // another tab wiped the registry); just keep trying to remove the key. Non-LOCAL kept.
  const local = localDefault();
  const legacy = readLegacy();
  // A tombstone read that threw means we can't confirm this legacy value is dead OR alive.
  // Refuse to migrate it (resurrection risk) but don't remove it either — a later load with
  // a readable tombstone resolves it correctly. Only absorb when retirement is KNOWN-absent.
  if (legacy && !tombUnknown && legacy !== retiredLegacyToken) { local.token = legacy; legacyBackedLocalToken = legacy; pendingLegacyRemoval = true; }
  else if (legacy && !tombUnknown) { pendingLegacyRemoval = true; } // retired leftover — schedule removal, don't absorb
  cache = stored ? [local, ...stored] : [local];
  dirty = true; // persist the seeded / reconstructed list (in its original stored shape)
  flush();
  return cache;
}

// Load the backend list, seeding + migrating on first run. Always returns at
// least the built-in LOCAL backend, and guarantees LOCAL is present even if a
// stored list somehow dropped it.
export function loadBackends(): Backend[] {
  const { ok, raw } = readRegistryRaw();
  // A read that THREW (private-mode SecurityError) is not a delete. With a warm cache,
  // keep it authoritative. With NO cache yet (cold load) we can't know what storage
  // holds — return an ephemeral LOCAL default WITHOUT caching or marking it dirty, so a
  // later successful load re-reads the real registry instead of a dirty-flush writing
  // over the (present but unreadable) stored token + REMOTE config once reads recover.
  if (!ok) {
    if (cache) { revalidateLegacy(); flush(); return cache; }
    return [localDefault()];
  }
  // Blind mutations made while storage was unreadable: now that we can read, MERGE them
  // onto the real registry instead of overwriting it with our partial cache. Replaying
  // through hydrate + applyToken preserves backends we never saw and the user's intent.
  if (cache && dirty && !cacheReconciled) {
    let merged = hydrate(raw);
    const stillDeferred: Array<{ id: string; token: string | undefined; idResolved: boolean }> = [];
    for (const m of pendingMutations) {
      // If the id was a guess (active read threw at call time), re-resolve it now that the
      // active key is readable again — the intent targeted "the active backend", whatever it is.
      // If the active read STILL throws, we can't safely resolve the target: keep the mutation
      // deferred rather than applying it to a guessed id (which could clear the wrong backend).
      let id = m.id;
      if (!m.idResolved) {
        const active = readActiveId();
        if (!active.ok) { stillDeferred.push(m); continue; }
        id = active.value;
      }
      merged = applyToken(merged, id, m.token);
      // A blind clear we couldn't classify at the time is now resolvable against the real
      // registry: if it targeted LOCAL (or an id absent from the registry), retire the
      // legacy value BY VALUE so the just-cleared token can't re-migrate on a later reload.
      if (!m.token && (id === LOCAL_BACKEND_ID || !merged.some((b) => b.id === id))) {
        retireLegacy(legacyBackedLocalToken || readLegacy());
        merged = merged.map((b) => (b.id === LOCAL_BACKEND_ID ? { ...b, token: undefined } : b));
      }
    }
    cache = merged;
    pendingMutations = stillDeferred;
    dirty = true;
    // Unresolved mutations remain (active still unreadable): keep the cache unreconciled so a
    // later load re-enters this merge branch and replays them — a reconciled cache would skip it.
    if (stillDeferred.length > 0) cacheReconciled = false;
    flush();
    return cache;
  }
  // Reconciled but unpersisted local changes are authoritative — never let storage
  // clobber them. Still revalidate the legacy key: another tab may have cleared a
  // legacy-backed LOCAL token even while our registry cache is mid-write.
  if (cache && dirty) { revalidateLegacy(); flush(); return cache; }
  // Single raw read drives both the no-op and revalidation paths, so the parsed value
  // and the raw we compare against can't drift out of sync.
  if (cache && raw === lastSeenRaw) { revalidateLegacy(); flush(); return cache; }
  // Cold load, or another tab changed storage (including a real delete → raw null):
  // adopt it through the same normalization a fresh page load uses.
  return hydrate(raw);
}

// Update the in-memory source of truth first, then best-effort mirror to
// storage. The cache update is what makes an explicit / 401 clear stick even
// when the write fails; `dirty` gets retried by flush() once storage recovers.
export function saveBackends(list: Backend[]): void {
  cache = list;
  dirty = true;
  // A full-list save with readable storage is authoritative and safe to persist.
  // Only a save made while storage is unreadable (a blind mutation) stays
  // unreconciled, to be replayed onto the real registry once reads recover.
  // BUT if blind mutations are still queued, this cache descends from an ephemeral
  // LOCAL default built while the registry was unreadable — even if reads have since
  // recovered, marking it reconciled would let it overwrite the real (REMOTE-bearing)
  // registry we never merged. Leave it unreconciled so loadBackends replays the intent.
  if (pendingMutations.length === 0 && readRegistryRaw().ok) cacheReconciled = true;
  flush();
}

// Test-only: drop the in-memory cache + deferred-write state so the next
// loadBackends() re-reads storage, simulating a fresh page load. Never in prod.
export function __resetForTests(): void {
  cache = null;
  cacheReconciled = false;
  dirty = false;
  pendingLegacyRemoval = false;
  legacyBackedLocalToken = undefined;
  retiredLegacyToken = undefined;
  lastSeenRaw = null;
  pendingMutations = [];
  pendingIntents = [];
  pendingTombstoneWrite = false;
  lastActiveId = undefined;
}

export function getActiveBackendId(): string {
  return readActiveId().value;
}

// The last active id we read SUCCESSFULLY. A later read that throws (SecurityError) is a
// transient failure, not a switch to LOCAL — falling back to this remembered id keeps a warm
// REMOTE session routing to REMOTE instead of misrouting to a guessed LOCAL default.
let lastActiveId: string | undefined;

// Read the active id, distinguishing a real value / default (`ok: true`) from a
// read that threw (`ok: false`). On a thrown read, `value` is the last id we read
// successfully (or LOCAL if we never did) — a best guess, NOT confirmation. Callers
// taking a DESTRUCTIVE action keyed on the id (retiring the legacy token, clearing) must
// gate on `ok`: an unreadable active key is unknown, not "definitely this id".
function readActiveId(): { ok: boolean; value: string } {
  try { const v = localStorage.getItem(ACTIVE_KEY) || LOCAL_BACKEND_ID; lastActiveId = v; return { ok: true, value: v }; }
  catch { return { ok: false, value: lastActiveId || LOCAL_BACKEND_ID }; }
}

export function setActiveBackendId(id: string): void {
  lastActiveId = id;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private mode */ }
}

export function getActiveBackend(): Backend {
  const list = loadBackends();
  const id = getActiveBackendId();
  return list.find((b) => b.id === id) || list.find((b) => b.id === LOCAL_BACKEND_ID) || localDefault();
}

// Persist a single-token intent by re-hydrating the FRESHEST registry raw first, then
// applying just that one (id → token) change onto it. This is the unified recovery write:
// a whole-list save would revert a concurrent cross-tab change to a DIFFERENT backend, but
// re-reading raw here means we only ever touch the one backend the intent names. Returns the
// resulting list (already cached + flushed).
function persistTokenIntent(id: string, token: string | undefined): Backend[] {
  const { ok, raw } = readRegistryRaw();
  // Unreadable storage → keep the in-memory cache authoritative for this session; a whole-list
  // save is the only option, and loadBackends already recorded the intent for later replay.
  const base = ok ? hydrate(raw) : (cache ?? [localDefault()]);
  const next = applyToken(base, id, token);
  saveBackends(next);
  // If the persistence write failed (still dirty), remember this as a SINGLE-backend intent so
  // flush() replays it by re-reading raw — not by re-writing the whole stale snapshot, which
  // would roll back a concurrent cross-tab rename/add. Clear `dirty` so flush skips whole-list.
  if (dirty && ok) { pendingIntents.push({ id, token }); dirty = false; }
  return next;
}

// Persist a token against the active backend (used by the login flow). Writing
// an empty string clears it. This replaces the old single-key token storage.
export function setActiveBackendToken(token: string): void {
  const active = readActiveId();
  // A CLEAR whose target we only GUESSED is destructive on the wrong backend: applying it to a
  // guessed LOCAL both drops LOCAL's token and lets flush() retire the legacy value. Skip it
  // ONLY when the registry WAS readable (reconciled) but the active-id read threw — there we're
  // about to act immediately on a wrong LIVE target and can't confirm it. When nothing was
  // readable (unreconciled), setBackendToken defers via pendingMutations and re-resolves the
  // real target on replay, so a legitimate blind clear still survives.
  if (!token && !active.ok && readRegistryRaw().ok) return;
  // active.ok tells the deferred-replay path whether `active.value` is a real id or a guess it
  // must re-resolve once the active key is readable again.
  setBackendToken(active.value, token, active.ok);
}

// Clear a SPECIFIC backend's token by id, but ONLY if it still holds `expectedToken` — the
// value captured in the failing request's snapshot. The 401 handler uses this so that (1) a
// token REFRESHED on the same backend mid-flight isn't wiped by a stale 401 for the old token,
// and (2) if that backend was DELETED mid-flight, the clear finds no match and is a no-op —
// never falling back onto LOCAL and clobbering an unrelated token.
export function clearBackendTokenIfMatches(id: string, expectedToken: string): void {
  const list = loadBackends();
  const target = list.find((b) => b.id === id);
  if (!target || target.token !== expectedToken) return; // refreshed, or backend gone — do nothing
  setBackendToken(id, '', true); // id is explicit and authoritative — never re-resolve it
}

// Shared token set/clear for a known backend id. `token===''` clears. `idResolved` = the id
// is authoritative (not a guessed active default); a deferred replay re-reads active when false.
function setBackendToken(id: string, token: string, idResolved: boolean): void {
  const list = loadBackends();
  const reconciled = cacheReconciled; // did the load above see real storage?
  // Explicitly clearing the LOCAL token must also invalidate the legacy source,
  // even if the registry write below fails (private mode / quota): otherwise the
  // next loadBackends() would re-migrate the stale legacy token and resurrect a
  // token the user just cleared. Retire the value so it stays dead across a failed
  // removal / registry wipe, and defer the key removal to flush().
  if (!token && (id === LOCAL_BACKEND_ID || !list.some((b) => b.id === id))) {
    retireLegacy(legacyBackedLocalToken || readLegacy());
  }
  // If storage was unreadable, this mutation was applied blind: record it so the next
  // successful read replays it onto the real registry rather than overwriting.
  if (!reconciled) { pendingMutations.push({ id, token: token || undefined, idResolved }); saveBackends(applyToken(list, id, token)); return; }
  // Reconciled: persist by re-hydrating the freshest raw so a concurrent cross-tab change to a
  // different backend survives — we only mutate the one backend this intent names.
  persistTokenIntent(id, token);
}
