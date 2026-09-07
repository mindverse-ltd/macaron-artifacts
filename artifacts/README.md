# Macaron Artifacts

A single React WebUI for native coding harnesses. Claude Code and Codex share the same conversation, approvals, UI4A rendering, session storage, and themes. The default layout and palette come from `ui4a-playground`.

```sh
pnpm install
pnpm dev
# UI: http://127.0.0.1:43861 — API: http://127.0.0.1:43860
pnpm build
pnpm start
```

Run these commands from the repository root. `MACARON_PORT` and `WEB_PORT` override the ports. Production serves the UI and API together. The new `macaron-artifacts` launcher also accepts `--port` and `--data-dir`.

Install and authenticate the native Claude Code or Codex CLI first. The app inherits their local configuration; an empty model field uses the harness default. `MACARON_CLAUDE_PATH` and `MACARON_CODEX_PATH` can select an executable. App conversations live in `~/.macaron-artifacts/sessions`; `MACARON_DATA_DIR` overrides that directory. Workspace files remain in the directory selected for each session. Deleting an app conversation does not delete workspace files.

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

AI SDK 7's experimental [HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview) is real and compatible with `useChat`. Its [Codex adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/codex) currently uses the Codex SDK in a network sandbox and does not support native tool approvals. This local app needs the [Codex app-server](https://developers.openai.com/codex/app-server) event stream and native approvals, so adapters normalize directly into AI SDK 7.0.93 UI message chunks. The client uses the version-matched `@ai-sdk/react` Chat and `useChat` APIs.

| Native capability | Claude Code | Codex app-server |
| --- | --- | --- |
| Text and reasoning deltas | Yes | Yes |
| Tool argument deltas | Yes | Not exposed by the current protocol |
| Command stdout/stderr deltas | Not exposed by the Agent SDK | Yes |
| Native approval | Yes | Yes |
| Disposable metadata fork | `resume` + `forkSession`, no persistence | Ephemeral `thread/fork` |

Metadata retains the same instructions, model and tool catalog, appending only its final metadata request. It runs outside the main turn and is cancelled when a new turn arrives. This is prefix-friendly; cache hits still depend on the upstream provider. Usage parts preserve the native cached-input count. Metadata failure leaves the main response intact.

## UI4A contract

- Inline: a fenced `ui4a/tsx` module renders in the conversation while its text arrives.
- Canvas: `.artifacts/canvases/<name>.ui4a.tsx` opens in the right panel. Relative TypeScript, TSX and JSON modules resolve inside `.artifacts`.
- Both use `partial-react@0.0.6`, `pushCode`/`finish`, last-good-frame preservation and a shared React instance.
- `$ui4a/ui` contains Button, Field, Card, Badge, Tabs and Disclosure. `$ui4a/chat`, `$ui4a/state` and `$ui4a/fs` are separate host capabilities.
- The module manifest generates `skills/ui4a/SKILL.md`; a test checks that the guidance matches the runtime. No theme name is added to the model prompt.

Generated code runs as trusted local React code in the host page, as in the reference playground; this is not an isolation sandbox for untrusted third-party code. File bridge access is restricted to the selected workspace's `.artifacts` tree, including symlink checks. The local API accepts loopback hosts and same-origin browser requests.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
```

Tests exercise raw Claude/Codex event conversion, real JSONL RPC framing, approval/cancellation, >4,000-event replay, crash recovery, metadata isolation, scoped capabilities and incremental rendering. Browser acceptance uses the real built application for inline and file previews, state retention, relative imports, theme switching and narrow layouts.

This branch introduces the unified app as the default development/build/start path. The old packages and launchers remain available through explicit `*:legacy` scripts while their deployment and native-history migration can be handled separately. OpenCode, dsh, pi and Kimi Code adapters, attachments, and the old administrative panels are outside this first adapter slice.
