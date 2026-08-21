// The analytics id of the run whose work is currently executing, for code that
// is nowhere near the route that started it — specifically the render_ui
// handler, which must attribute `render_ui_called` to the right turn.
//
// Two transports, because render_ui has two homes (see macaron-render-tool.ts):
//
//   in-process (Claude)  the SDK invokes the tool handler from inside the
//                        route's own async context, so AsyncLocalStorage
//                        carries the id down without threading a parameter
//                        through the SDK's API, which has no slot for one.
//   child process (Codex, Kimi)  the engine CLI spawns the stdio MCP server, so
//                        the id travels as MACARON_RUN_ID on the engine's env
//                        and is inherited.
//
// Returns undefined when neither applies (a tool call outside any run we
// started). Callers report the event without a runId rather than guessing.

import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<string>();

export function withRunId<T>(runId: string, fn: () => T): T {
  return store.run(runId, fn);
}

export function currentRunId(): string | undefined {
  return store.getStore() ?? process.env.MACARON_RUN_ID ?? undefined;
}
