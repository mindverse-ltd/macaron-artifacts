# Macaron · Claude Code plugin (demo)

A Claude Code plugin that opens a local **WebUI** giving you three things you can't get from the CLI alone:

1. **Visual `/resume`** — browse Claude Code workspaces & sessions with previews; one click copies the `--resume` command.
2. **Live chat** — continue any session (or start a new one) in the browser; streams thinking, tool calls and GenUI previews via the Claude Agent SDK.
3. **Provider switcher** — run sessions against your ambient Claude Code login or any Anthropic-compatible endpoint (Macaron, OpenRouter, LiteLLM, …).

The plugin bundles the official **`genui-builder` skill** so any Claude Code instance that has it loaded can also produce GenUI TSX from the command line.

---

## Install

The public repository doubles as a plugin marketplace for both Claude Code and Codex.

### Claude Code

In a Claude Code session, run each command separately:

```
/plugin marketplace add https://github.com/MindLab-Research/macaron-artifacts
```

```
/plugin install macaron@macaron
```

After installing, open it from any Claude Code session:

```
/macaron
```

### Codex

```bash
codex plugin marketplace add MindLab-Research/macaron-artifacts
codex plugin add macaron@macaron
```

After installing, start a new Codex session and say:

```
打开 macaron web ui
```

For local development, install your checkout directly:

```bash
claude plugin install /path/to/checkout
```

## Update

### Claude Code

```
/plugin marketplace update macaron
/reload-plugins
/macaron:macaron
```

### Codex

```bash
codex plugin marketplace upgrade macaron   # pull the latest marketplace snapshot
codex plugin remove macaron@macaron
codex plugin add macaron@macaron           # reinstall the plugin
```

## Use

Inside any Claude Code session:

```
/macaron
```

The slash command starts the local server (`node server/dist/index.js`, port `7878` by default) and opens `http://localhost:7878` in your browser. Pass a custom port with `/macaron 8080`.

### Views

| View          | What it does |
| ------------- | ------------ |
| **Dashboard** | All workspaces from `~/.claude/projects/**/*.jsonl`, sorted by last activity. |
| **Workspace** | Sessions of one project with previews; start a new session from here. |
| **Session**   | Full transcript (thinking, tool calls, live GenUI TSX previews) + follow-up messages streamed over SSE. |
| **Settings**  | Manage Anthropic-compatible providers and pick the active one (stored in `~/.claude/macaron-config.json`). |

## Configure

Zero config by default — sessions run against your ambient Claude Code login. Add Macaron or any Anthropic-compatible provider from the **Settings** page (persisted to `~/.claude/macaron-config.json`). You can still copy `.env.example` to `.env` (git-ignored) for server-only options such as port or log level:

```bash
MACARON_PORT=7878             # optional
MACARON_LOG_LEVEL=debug       # optional
```

## Layout

```
.claude-plugin/                   plugin manifest + marketplace (install from GitHub)
commands/macaron.md               /macaron slash command
skills/genui-builder/             bundled skill (used by Claude Code directly)
start.sh                          one-time npm install + build, boots server in background
shared/                           domain types + SSE protocol (server ↔ web)
server/                           Fastify API, Claude Agent SDK runner, provider relay
web/                              Vite + React UI
```

## Notes

- Built and tested against **Node 22**.
- Claude Code stores project directories as `~/.claude/projects/-<encoded-path>`; hyphens in the original folder name are ambiguous (we display the best-guess decoded path).
