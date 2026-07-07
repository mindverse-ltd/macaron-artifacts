#!/usr/bin/env bash
set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Load local .env if present (never committed — see .env.example for the
# required MACARON_API_BASE / MACARON_API_KEY variables).
if [ -f "$DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$DIR/.env"
  set +a
fi

PORT="${MACARON_PORT:-7878}"
# Engine picks which SPA `/` serves. `codex` renders the Codex-focused
# session manager; anything else (default) renders the Claude one.
# The Codex plugin's macaron-webui skill sets this to `codex`.
ENGINE="${MACARON_ENGINE:-claude}"
# `1` = block in the foreground (`exec node …`). The Codex plugin sets
# this because its Bash tool kills backgrounded children when the outer
# script returns. Default = background with nohup so the Claude Code
# `/macaron` command can return the URL and continue.
FOREGROUND="${MACARON_FOREGROUND:-0}"

WEB_DIST="$DIR/web/dist"
SERVER_DIST="$DIR/server/dist/index.js"

# `npm install` on macOS arm64 sometimes skips Rollup's platform-specific
# optional dep when the lock was generated elsewhere (npm/cli#4828) — the
# build then blows up with "Cannot find module @rollup/rollup-darwin-arm64".
# --include=optional forces the platform binaries in; --no-audit / --no-fund
# just cut noise.
run_install() {
  (cd "$DIR" && npm install --silent --include=optional --no-audit --no-fund)
}

# npm's optional-dep bug means even --include=optional won't insert the
# platform-specific rollup binary when a foreign package-lock exists. We
# can't safely delete package-lock.json (it's committed), so after install
# we spot-check that the current platform's rollup native module is present
# and force-install it if not.
ensure_rollup_platform() {
  local os arch pkg workdir
  workdir="$DIR/web"
  os="$(node -p 'process.platform' 2>/dev/null || echo unknown)"
  arch="$(node -p 'process.arch' 2>/dev/null || echo unknown)"
  case "$os-$arch" in
    darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64) pkg="@rollup/rollup-${os}-${arch}" ;;
    *) return 0 ;;
  esac
  if [ ! -d "$workdir/node_modules/@rollup/rollup-${os}-${arch}" ]; then
    echo "[macaron] adding $pkg (workaround for npm/cli#4828)…" >&2
    (cd "$workdir" && npm install --no-save --silent --no-audit --no-fund "$pkg") || true
  fi
}

if [ ! -d "$DIR/node_modules" ] || [ ! -d "$DIR/server/node_modules" ] || [ ! -d "$DIR/web/node_modules" ]; then
  echo "[macaron] installing workspaces (one-time, ~30s)…" >&2
  run_install
fi
ensure_rollup_platform

# Rebuild when dist is missing OR when any tracked source file is newer
# than the current bundle — so `claude plugin update` (git pull) picks up
# code changes without users having to blow the cache away by hand.
needs_build=0
if [ ! -f "$SERVER_DIST" ] || [ ! -f "$WEB_DIST/index.html" ]; then
  needs_build=1
elif [ -n "$(find "$DIR/web/src" "$DIR/server/src" "$DIR/shared/src" \
       -newer "$WEB_DIST/index.html" -type f -print -quit 2>/dev/null)" ]; then
  needs_build=1
fi
if [ "$needs_build" -eq 1 ]; then
  echo "[macaron] building (~30s)…" >&2
  if ! (cd "$DIR" && npm run build --silent); then
    # Most likely the rollup platform binary is still missing. Retry
    # the platform install and one more build attempt before giving up.
    echo "[macaron] build failed — re-adding rollup platform dep and retrying…" >&2
    ensure_rollup_platform
    (cd "$DIR" && npm run build --silent)
  fi
fi

# Kill any prior instance bound to this port.
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti :"$PORT" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    echo "[macaron] killing existing process on port $PORT: $PIDS" >&2
    kill -9 $PIDS 2>/dev/null || true
    sleep 0.3
  fi
fi

LOG="/tmp/macaron-plugin.log"
cd "$DIR"

export MACARON_ENGINE="$ENGINE"
export MACARON_PORT="$PORT"

if [ "$FOREGROUND" = "1" ]; then
  # Foreground: schedule a health-check probe in the background that
  # prints the URL once the server accepts requests, THEN exec node so
  # this shell is REPLACED by the server (parent's death can't SIGHUP it
  # into oblivion the way `nohup … & disown` sometimes fails in
  # sandboxed shells).
  (
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 0.5
      if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
        echo "Macaron WebUI (engine=$ENGINE): http://localhost:$PORT"
        exit 0
      fi
    done
    echo "[macaron] server didn't answer /api/health within 5s" >&2
  ) &
  exec node "$SERVER_DIST"
else
  # Background: original behavior, keeps `/macaron` command in Claude
  # Code returning quickly so it can echo the URL.
  nohup node "$SERVER_DIST" > "$LOG" 2>&1 &
  SERVER_PID=$!
  disown "$SERVER_PID" 2>/dev/null || true

  for _ in 1 2 3 4 5 6; do
    sleep 0.5
    if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      break
    fi
  done

  echo "Macaron WebUI (engine=$ENGINE): http://localhost:$PORT"
  echo "PID: $SERVER_PID  (log: $LOG)"
fi
