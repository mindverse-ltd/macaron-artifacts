# Macaron Artifacts

One React WebUI for coding harnesses. Install the `macaron-artifacts` package, start one local server, then choose Claude Code, Codex, OpenCode, or pi when creating a conversation. All four use the same chat, approvals, Canvas, and Shiki themes.

## Install and run

Requires Node.js 22.19 or newer. Claude Code, Codex, and OpenCode use their installed, authenticated native CLI and local configuration. The pi SDK is included in the package and reads your local `~/.pi/agent` configuration; a separate pi executable is not required.

Run a commit's preview package directly:

```sh
bunx macaron-artifacts@https://pkg.pr.new/mindverse-ltd/macaron-artifacts/macaron-artifacts@<sha>
```

Or install that same package globally:

```sh
npm install -g https://pkg.pr.new/mindverse-ltd/macaron-artifacts/macaron-artifacts@<sha>
macaron-artifacts
```

Replace `<sha>` with the commit from a successful [package preview build](https://github.com/mindverse-ltd/macaron-artifacts/actions/workflows/pkg-pr-new.yml). Open `http://127.0.0.1:43860`, create a conversation, and choose its harness and workspace. An empty model field uses the harness default; for OpenCode and pi, enter an optional override as `provider/model`.

```sh
macaron-artifacts --port 43860 --data-dir /path/to/session-data
macaron-artifacts --help
```

There is one published package and one launcher. The old `mcc`, `mcx`, and `mkx` distributions are discontinued; harness selection belongs inside the unified application.

The previous WebUI, plugin launchers, and replay tools are archived on the [`v0` branch](https://github.com/mindverse-ltd/macaron-artifacts/tree/v0).

## Features

- Native text, reasoning, tool arguments, and command output stream at the granularity each harness exposes.
- Switching conversations keeps background turns running. Refreshing reconnects to an active turn; explicit Stop cancels it.
- Harness approval requests and pi tool approvals appear in the conversation.
- Titles and follow-up suggestions run on disposable native forks after the main response, preserving its prompt prefix without blocking the composer.
- Inline `ui4a/tsx` fences render as their source arrives. Files at `.artifacts/canvases/<name>.ui4a.tsx` render in Canvas, including relative TSX, TypeScript, and JSON imports.
- Generated components use a small `$ui4a/ui` library and scoped chat, state, and file capabilities. Shiki themes drive both syntax highlighting and interface colors.

Claude Code, Codex, OpenCode, and pi are supported. Kimi Code, Hermes, and dsh are deferred; see [the application guide](artifacts/README.md#deferred-adapters) for the current integration gaps. Native session-history migration and attachments are not included yet.

## Configuration

| Setting | Purpose |
| --- | --- |
| `MACARON_PORT` | UI and API port, default `43860` |
| `MACARON_DATA_DIR` | App conversation storage, default `~/.macaron-artifacts/sessions` |
| `MACARON_CLAUDE_PATH` | Claude Code executable |
| `MACARON_CODEX_PATH` | Codex executable |
| `MACARON_OPENCODE_PATH` | OpenCode executable |
| `PI_CODING_AGENT_DIR` | pi configuration directory, default `~/.pi/agent` |

For a custom Claude gateway, launch with the same `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` environment as your CLI. Variables injected only by a shell alias do not reach a separately launched app.

Workspace files remain in each conversation's selected directory. Deleting an app conversation does not delete those files. The API binds to loopback and accepts same-origin browser requests. Generated React runs in the host page; use it with trusted local code.

## Development

From the repository root:

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Development serves the UI on `http://127.0.0.1:43861` and API on `http://127.0.0.1:43860`; `WEB_PORT` and `MACARON_PORT` override them. Production serves both from one port.

See [the application guide](artifacts/README.md) for module boundaries, streaming contracts, and validation.
