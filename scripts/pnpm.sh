#!/usr/bin/env bash
set -euo pipefail

# Bootstrap with npm, which ships with Node. Bundled Corepack cannot resolve
# our major range, and older global pnpm cannot read the env lockfile document.
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
PNPM_MAJOR="$(node -p 'require(process.argv[1]).devEngines.packageManager.version' "$PWD/package.json")"
BOOTSTRAP="$ROOT/node_modules/.pnpm-bootstrap"
PNPM_BIN="$BOOTSTRAP/node_modules/.bin/pnpm"

if [[ "$("$PNPM_BIN" --version 2>/dev/null || true)" != "$PNPM_MAJOR".* ]]; then
  echo "[macaron] installing pnpm@$PNPM_MAJOR locally (one-time)…" >&2
  if ! npm install --prefix "$BOOTSTRAP" --no-save --no-package-lock --no-audit --no-fund "pnpm@$PNPM_MAJOR" >&2; then
    echo "[macaron] could not install pnpm@$PNPM_MAJOR; check npm's error above and retry." >&2
    exit 1
  fi
fi

# Package scripts and host-webui.mjs spawn plain `pnpm`; keep them on the same
# binary even when the caller's PATH contains an older global pnpm or shim.
export PATH="$(dirname "$PNPM_BIN"):$PATH"
exec "$PNPM_BIN" "$@"
