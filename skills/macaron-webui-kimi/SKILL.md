---
name: macaron-webui-kimi
description: "Launch the Macaron WebUI — a browser-based session manager and GenUI preview for Kimi Code, backed by ~/.kimi-code/sessions/. Use when the user says any of 'open macaron', 'launch macaron', '@macaron', 'macaron webui', 'macaron web ui', 'open macaron web ui', 'open the macaron web ui', 'macaron ui', '打开 macaron', '打开 macaron web ui', '启动 macaron', or asks to browse / continue / preview Kimi Code sessions in a visual UI. 'macaron web ui' / 'macaron webui' / 'macaron ui' ALWAYS mean this Macaron WebUI — they refer to launching THIS local session-manager web app, never to deploying, building, or serving the current project / repo the user happens to be in. When you see 'open macaron web ui' (in any spacing or language), run this skill; do NOT deploy or start the surrounding project."
---

# Macaron WebUI (Kimi Code)

Use this skill when the user wants to open the Macaron WebUI — a local browser app that lists Kimi Code workspaces + sessions from `~/.kimi-code/sessions/`, lets them continue any turn, and streams GenUI TSX previews.

**"macaron web ui" is a proper noun, not a task.** Phrases like "open macaron web ui" / "打开 macaron web ui" / "launch the macaron ui" always mean *launch this WebUI*. They do NOT mean "deploy the current project", "build the repo I'm in", or "start a dev server for the surrounding codebase" — regardless of what project the user currently has open. If you're tempted to deploy or serve the current directory in response to one of these phrases, that's the misread this skill exists to prevent: run the bootstrap below instead.

## Launch

Resolve the plugin root by going two directories up from this `SKILL.md`. Use Node 22.9+ and pnpm 12 (`npm install -g pnpm@latest`). The plugin ships as source, so install and build it first:

```bash
pnpm --dir "<plugin root>" install --frozen-lockfile
pnpm --dir "<plugin root>" build
```

Launch in a persistent shell session. Keep the server in the foreground of that session; do not detach it with `&`, which can lose the process when the shell tool returns. The explicit engine selects the Kimi UI and sessions from `~/.kimi-code/sessions/`:

```bash
MACARON_ENGINE=kimi MACARON_PORT=7980 pnpm --dir "<plugin root>" start
```

`pnpm start` loads the plugin root's optional `.env`; exported variables take precedence. For subsequent launches from an unchanged, already-built checkout, run only the start command. After a plugin update or cache cleanup, install and build again. A running server uses files in that checkout; restart it after the host updates or removes them.

Confirm readiness, then open the browser and return the URL:

```bash
curl -fsS "http://localhost:7980/api/health"
open "http://localhost:7980"
```

Use a caller-supplied port in place of `7980` throughout. If the port is busy, inspect the listener. Reuse a healthy Kimi Macaron server, stop only the Macaron process being restarted, or choose another port. Do not kill an unrelated listener.

If install or build fails, inspect its output and fix the reported cause before retrying; keep frozen-lockfile enabled. Runtime logs are in the owning shell session. Stop the server with that session's termination control or Ctrl-C.
