# Macaron Artifacts

A single React WebUI for native coding harnesses. Claude Code, Codex, OpenCode, and pi share the same conversation, approvals, UI4A rendering, session storage, and themes. The default layout and palette come from `ui4a-playground`.

## Install and run

The only published package and CLI is `macaron-artifacts`. Choose Claude Code, Codex, OpenCode, or pi inside the application; installing another WebUI package is not required to switch harnesses. Node.js 22.19 or newer is required.

```sh
bunx macaron-artifacts@https://pkg.pr.new/mindverse-ltd/macaron-artifacts/macaron-artifacts@<sha>
```

Use the SHA from a successful package preview build, then open `http://127.0.0.1:43860`. For a persistent installation, install that same package URL with `npm install -g` and run `macaron-artifacts`. The launcher accepts `--port` and `--data-dir`.

## Development

```sh
pnpm install
pnpm dev
# UI: http://127.0.0.1:43861 — API: http://127.0.0.1:43860
pnpm build
pnpm start
```

Run these commands from the repository root. `MACARON_PORT` and `WEB_PORT` override the ports. Production serves the UI and API together.

Install and authenticate the native CLI for Claude Code, Codex, or OpenCode. `MACARON_CLAUDE_PATH`, `MACARON_CODEX_PATH`, and `MACARON_OPENCODE_PATH` can select each executable. The bundled pi SDK uses local `~/.pi/agent` configuration; `PI_CODING_AGENT_DIR` overrides that directory, and no pi executable is required. An empty model field uses the harness default. OpenCode and pi accept an optional `provider/model` override.

App conversations live in `~/.macaron-artifacts/sessions`; `MACARON_DATA_DIR` overrides that directory. Workspace files remain in the directory selected for each session. Deleting an app conversation does not delete workspace files.

For a custom Claude gateway, start the app with the same `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` environment as the CLI. Environment injected only by a shell alias is not inherited by a separately launched app.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `src/server/harnesses` | Native lifecycle, protocol conversion, permission callbacks, capability declarations |
| `src/server/conversations.ts`, `store.ts` | One turn per session, persistence, complete increment journal, disconnect/reconnect and explicit cancellation |
| `src/server/enrichment.ts` | Background title and suggestions on a disposable native fork |
| `src/server/artifacts.ts` | Full-file speculative previews from tool input; authoritative reads after writes and patches |
| `src/shared/types.ts` | AI SDK UI messages and host data parts; no harness-owned UI types |
| `src/web/chat` | Stable per-session AI SDK Chat instances, queueing, metadata subscription |
| `src/web/components` | Shared conversation, composer, sidebar, approvals and Canvas views |
| `src/web/ui4a` | Incremental TSX renderer, scoped module registry, relative imports and state |
| `src/web/theme` | Shiki palette → semantic CSS variables shared by the UI and generated components |

New harnesses implement `HarnessAdapter` and register their capabilities. They do not add another SPA, sidebar, message store or Canvas. Native event boundaries pass through unchanged. Rendering can coalesce work already waiting on a compile; there is no fixed transport debounce.

## Why native adapters with AI SDK UI

AI SDK 7's experimental [HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview) and harness packages were assessed; the official `harness-pi` package supports a host process, so sandboxing is not a universal constraint. Direct native integration keeps control over session persistence, metadata branches, local configuration, and approval callbacks. We use the Claude SDK, [Codex app-server](https://developers.openai.com/codex/app-server), OpenCode SDK connected to its local CLI server, and pi SDK, normalizing their events into the existing AI SDK UI message stream. The client keeps its shared `@ai-sdk/react` Chat and `useChat` APIs.

| Native capability | Claude Code | Codex app-server | OpenCode | pi |
| --- | --- | --- | --- | --- |
| Text and reasoning deltas | Yes | Yes | Yes | Yes |
| Tool input | Raw argument deltas | Completed input | Input snapshots, not argument deltas | Raw argument deltas |
| Command output | No live output exposed by the Agent SDK | Raw stdout/stderr deltas | Tool output snapshots | Cumulative native output updates |
| Approval | Native callback | Native request | Native permission request | Host gate using the SDK tool execution hook |
| Disposable metadata fork | `resume` + `forkSession`, no persistence | Ephemeral `thread/fork` | Native session fork, deleted after use | Native branch held in memory |

Metadata retains the same instructions, model and tool catalog, appending only its final metadata request. OpenCode's fork blocks execution through a tool hook; pi uses an in-memory native branch that retains session affinity and blocks tools at execution. It runs outside the main turn and is cancelled when a new turn arrives. This is prefix-friendly; cache hits still depend on the upstream provider. Usage parts preserve the native cached-input count. Metadata failure leaves the main response intact.

OpenCode's native question dialogs and pi prompts that require a terminal UI are not supported in the WebUI. Tool execution approvals use the shared conversation controls.

## UI4A contract

- Inline: a fenced `ui4a/tsx` module renders in the conversation while its text arrives.
- Canvas: `.artifacts/canvases/<name>.ui4a.tsx` opens in the right panel. Relative TypeScript, TSX and JSON modules resolve inside `.artifacts`.
- Both use `partial-react@0.0.6`, `pushCode`/`finish`, last-good-frame preservation and a shared React instance.
- This application's small `$ui4a/ui` library contains Button, Field, Card, Badge, Tabs and Disclosure, following `ui4a-playground`'s lightweight Headless UI and Wind4 approach. Compose layouts with native HTML and UnoCSS Wind4 utilities; use `@headlessui/react` and `recharts` directly for additional controls and charts. `$ui4a/chat`, `$ui4a/state` and `$ui4a/fs` are separate host capabilities.
- The module manifest generates `skills/ui4a/SKILL.md`; a test checks that the guidance matches the runtime. No theme name is added to the model prompt.
- All bundled Shiki themes are searchable in the sidebar. Hover or use arrow keys to preview; click or press Enter to save. Closing the picker restores the saved palette. UI colors normalize missing and transparent editor tokens and validate text, button, hover, and focus contrast.

Generated code runs as trusted local React code in the host page, as in the reference playground; this is not an isolation sandbox for untrusted third-party code. File bridge access is restricted to the selected workspace's `.artifacts` tree, including symlink checks. The local API accepts loopback hosts and same-origin browser requests.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:package
MACARON_PACKAGE_SOURCE=https://pkg.pr.new/mindverse-ltd/macaron-artifacts/macaron-artifacts@<sha> pnpm test:package
```

Tests exercise harness event conversion, real JSONL RPC framing, approval/cancellation, >4,000-event replay, crash recovery, metadata isolation, scoped capabilities and incremental rendering. Browser acceptance uses the real built application for inline and file previews, state retention, relative imports, theme switching and narrow layouts.

`test:package` builds and installs the package into an empty consumer directory, then starts its CLI and checks the harness catalog and all client assets. `MACARON_PACKAGE_SOURCE` runs the same acceptance checks against a published preview URL or an existing tarball.

The root package publishes only the unified application. The old `mcc`, `mcx`, and `mkx` distributions are discontinued. Native session-history migration, attachments, and the old administrative panels are outside this adapter slice.

## Deferred adapters

Kimi Code still needs instruction-plugin integration, an execution gate covering every tool for metadata branches, and a compatible mapping for native question options. Hermes ACP forks do not preserve the selected provider and cached system prompt, and ACP exposes no session deletion for disposable metadata forks. Neither harness is selectable in this release. A dsh adapter is also deferred.
