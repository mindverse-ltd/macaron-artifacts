#!/usr/bin/env bash
# Macaron Artifacts — one-liner installer + launcher for users coming from a
# relay's docs page. Skips Claude Code entirely (the `/macaron` slash command
# path still works too — this is the "no REPL, just a browser" flavor).
#
# Ships to https://macaron.im/install.sh (redirect / mirror of this file).
#
# Usage — with a Macaron-hosted API relay:
#
#   export ANTHROPIC_BASE_URL='https://mint.macaron.im/v1'
#   export ANTHROPIC_AUTH_TOKEN='sk-xxx'
#   bash <(curl -fsSL https://macaron.im/install.sh)
#
# Or use the macaron-scoped env vars if you don't want to alter the ANTHROPIC_*
# ones for the rest of your shell:
#
#   export MACARON_PROVIDER_ENDPOINT='https://mint.macaron.im/v1'
#   export MACARON_PROVIDER_TOKEN='sk-xxx'
#   export MACARON_PROVIDER_MODEL='macaron-v1-venti'
#   export MACARON_PROVIDER_NAME='Mint'
#   bash <(curl -fsSL https://macaron.im/install.sh)
#
# What this does:
#   1. Checks the local `git` + `node` toolchain.
#   2. Clones / updates the plugin source to ~/.macaron/artifacts-src (override
#      with MACARON_ARTIFACTS_HOME=/some/path).
#   3. Installs and builds with pnpm, then serves the WebUI on http://localhost:7878.
#   4. The server's boot-time seedProviderFromEnv() picks up the env vars above,
#      upserts them as a saved provider, and (if you were still on the built-in
#      System provider) activates it. Open the URL and start — no manual
#      Settings → Add provider needed.

set -euo pipefail

PLUGIN_HOME="${MACARON_ARTIFACTS_HOME:-$HOME/.macaron/artifacts-src}"
REPO_URL="${MACARON_ARTIFACTS_REPO:-https://github.com/MindLab-Research/macaron-artifacts.git}"
BRANCH="${MACARON_ARTIFACTS_BRANCH:-main}"
PORT="${MACARON_PORT:-7878}"

log() { printf '[macaron] %s\n' "$*"; }
die() { printf '[macaron] error: %s\n' "$*" >&2; exit 1; }

command -v git  >/dev/null 2>&1 || die "git not found. Install: https://git-scm.com/"
command -v node >/dev/null 2>&1 || die "node not found. Install Node 22.9+: https://nodejs.org/"

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 9) ? 0 : 1)' || die "Source installs need Node 22.9+ for the native .env loader."

# Clone or update the plugin source. Depth 1 keeps the download small; a full
# reset --hard on refresh means local edits under PLUGIN_HOME are discarded —
# which is fine because this dir is our own managed install target.
if [ ! -d "$PLUGIN_HOME/.git" ]; then
  log "installing to $PLUGIN_HOME (fresh clone)…"
  mkdir -p "$(dirname "$PLUGIN_HOME")"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PLUGIN_HOME"
else
  log "updating $PLUGIN_HOME…"
  git -C "$PLUGIN_HOME" fetch --depth 1 origin "$BRANCH"
  git -C "$PLUGIN_HOME" reset --hard "origin/$BRANCH"
fi

cd "$PLUGIN_HOME"
npm exec --yes --package=pnpm@latest -- sh -c 'pnpm install --frozen-lockfile && pnpm build'

# Start the browser probe after the build, so installation time does not consume
# the readiness timeout. The server stays in the foreground.
open_when_ready() {
  local url="http://localhost:$PORT"
  local i=0
  while [ "$i" -lt 60 ]; do
    if curl -sf "$url/api/workspaces" >/dev/null 2>&1; then
      log "opening $url"
      if   command -v open >/dev/null 2>&1;     then open "$url"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true
      else                                          log "browser open failed — visit $url manually"
      fi
      return
    fi
    sleep 0.5
    i=$((i + 1))
  done
  log "server didn't come up on port $PORT within 30s — check the log above"
}
open_when_ready &

# env vars we care about (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, MACARON_PROVIDER_*)
# propagate through exec into the Node server, where seedProviderFromEnv reads
# them at startup.
export MACARON_ENGINE="${MACARON_ENGINE:-claude}"
export MACARON_PORT="$PORT"
exec node --env-file-if-exists=.env server/dist/index.js
