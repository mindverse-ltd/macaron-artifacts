---
description: Launch the Macaron WebUI (GenUI builder, model switcher, session manager)
allowed-tools: Bash(pnpm:*), Bash(curl:*), Bash(open http\://*)
---

Start the Macaron WebUI server. The Claude Code flavor always launches on the fixed port 7878 (Codex uses 7979, Kimi 7980, so all three can run side by side) — there is no port argument.

The plugin ships as source. Use Node 22.9+ and pnpm 12 (`npm install -g pnpm@latest`), then install and build from the plugin root:

```bash
pnpm --dir "${CLAUDE_PLUGIN_ROOT}" install --frozen-lockfile
pnpm --dir "${CLAUDE_PLUGIN_ROOT}" build
```

Start in a background task managed by the shell tool so the server remains alive after replying. `MACARON_ENGINE` and `MACARON_PORT` are explicit so stray exports cannot select a different engine. `pnpm start` reads the plugin root's optional `.env`; exported variables take precedence.

```bash
MACARON_ENGINE=claude MACARON_PORT=7878 pnpm --dir "${CLAUDE_PLUGIN_ROOT}" start
```

For subsequent launches from an unchanged, already-built checkout, run only the start command. After a plugin update or cache cleanup, install and build again. A running server uses files in that checkout; restart it after the host updates or removes them.

**Zero-config provider (relay operators):** if the user's shell has any of the following env vars set when `/macaron` runs (or when `install.sh` runs — see below), the server upserts them as a saved provider at boot and auto-selects it (unless the user has already picked a non-`system` provider manually). Same env-var contract works for the `claude` CLI, so a single copy-paste snippet on a relay's docs page bootstraps both flows:

```
MACARON_PROVIDER_ENDPOINT  or  ANTHROPIC_BASE_URL             (required)
MACARON_PROVIDER_TOKEN     or  ANTHROPIC_AUTH_TOKEN | ANTHROPIC_API_KEY  (required)
MACARON_PROVIDER_MODEL     or  ANTHROPIC_MODEL                (default: macaron-v1-venti)
MACARON_PROVIDER_NAME                                         (default: derived from endpoint host, e.g. "Mint (env)")
MACARON_DISABLE_ENV_PROVIDER_SEED=1                           (escape hatch — skip the whole thing)
```

Provider id is `sha1(endpoint + model)`, so re-running the same snippet upserts the same row instead of piling up duplicates. Later env changes (e.g. rotated key) refresh in place on the next `/macaron`.

For users who don't want to open Claude Code just to launch the WebUI, `install.sh` clones/updates the source into `~/.macaron/artifacts-src`, installs and builds with pnpm, and opens the browser once the server is ready. Intended for hosting at `https://macaron.im/install.sh`:

```bash
export ANTHROPIC_BASE_URL='https://mint.macaron.im/v1'
export ANTHROPIC_AUTH_TOKEN='sk-xxx'
bash <(curl -fsSL https://macaron.im/install.sh)
```

Both paths run the same server and `seedProviderFromEnv()`, so provider seeding behaviour is identical.

Confirm readiness with `curl -fsS http://localhost:7878/api/health`, then run `open "http://localhost:7878"` and return the URL:

- **Dashboard** — all workspaces from `~/.claude/projects`, sorted by last activity
- **Workspace** — one project's sessions with previews; start a new session from here
- **Session** — full transcript (thinking, tool calls, live GenUI previews) + follow-up chat
- **Settings** — manage Anthropic-compatible providers (Macaron, OpenRouter, LiteLLM, …) and pick the active one

If a command fails:

- **Port busy**: inspect the listener. Reuse a healthy Claude Macaron server, or stop only the Macaron process being restarted. Do not kill an unrelated listener.
- **Install / build failed**: inspect that command's output and fix the reported cause before retrying; keep frozen-lockfile enabled.
- **Runtime error**: read the output of the shell task that owns the server. Stop it with that task's termination control or Ctrl-C.
