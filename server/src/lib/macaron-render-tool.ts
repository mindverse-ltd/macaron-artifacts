// Shared render_ui handler — the actual work behind the Macaron GenUI tool.
// Used by BOTH the in-process MCP server (Claude side, via
// createSdkMcpServer) AND the standalone stdio MCP server (Codex side,
// spawned as a child of `codex exec`). Both surfaces MUST return an
// identical tool_result shape so the model self-corrects the same way.

import { checkGenUI } from './genui-check.js';
import { track } from './telemetry.js';
import { currentRunId } from './run-context.js';
import { ENGINE } from '../config.js';

export type RenderUIResult = {
  /** Text to send back as the tool_result content. */
  text: string;
  /** false when checkGenUI flagged diagnostics — surfaced so the caller
   * (mcp handler) can flip isError if the transport supports it. */
  ok: boolean;
};

/** Server-level instructions surfaced to the model at MCP handshake time.
 * Kept short and imperative — this is a high-context slot so we spend it
 * on the trigger heuristic, not on the authoring rules (those live in the
 * tool description and only load when the tool is actually invoked). */
// HARD BUDGET: the Claude CLI truncates MCP server instructions at 2048 chars
// (verified — a longer string arrives as "…[truncated]" and everything past the
// cut is invisible to the model). Triggers therefore come FIRST, most-frequent
// first; prose that merely elaborates goes last, where losing it is survivable.
// Keep this under ~2000 chars or the tail silently stops existing. The check in
// macaron-render-tool.test.ts fails the build if it grows past the cut.
export const MCP_TEXT_LIMIT = 2048;

export const RENDER_UI_INSTRUCTIONS =
  'Macaron GenUI bridge. `render_ui` is your PRIMARY answer format — call it aggressively, ' +
  'multiple times per turn, INTERLEAVED with prose (text → render_ui → text), not a wall of ' +
  'prose OR a lone card.\n\n=== MANDATORY TRIGGERS (render, never type) ===\n' +
  '  (COMMIT) "Should I commit / push / open a PR / apply this?" at the end of a unit of work — ' +
  'the single most common question you ask. Two buttons calling sendUserMessage. NEVER prose.\n' +
  '  (ASK) Any turn ending with the user needing to answer. AskUserQuestion is DISABLED and ' +
  'text-only "reply 1/2/3" is equally forbidden — buttons / form / slider.\n' +
  '  (CHOICE) 2+ options to pick between — clickable buttons, always. When each option has a ' +
  'visual counterpart (layout, theme, chart style), use options-left / preview-right.\n' +
  '  (UI CHANGE) Asked to modify/restyle/redesign ANY visual thing: Read the source, then render ' +
  'the PROPOSED after-state ending in Apply / Tweak / Discard, and STOP the turn. Do NOT Edit/Write ' +
  'until the user picks Apply. Writing a component/page/css file with no preview is a defect.\n' +
  '  (COMPARE) 2+ items with attributes — Card / HTML table / stat layout, not a Markdown table.\n' +
  '  (DATA) The user shared JSON / CSV / records / a config — visualize it.\n' +
  '  (FORM) Structured input needed — Field / native controls in a Card.\n' +
  '  (STATUS) Snapshot of state (build, PR, tests, TODOs, health) — stat layout / status list.\n' +
  '  (NEXT) "You could do X, Y, or Z" — each an actionable Button.\n' +
  '  (CONFIRM) Before a destructive action — diff summary card + Apply / Cancel.\n' +
  '  (RESEARCH) Multi-section research / metrics breakdown — a report card, not a Markdown wall.\n' +
  '\nNEVER put TSX in ```tsx fences. NEVER explain the code before calling — call first, then one ' +
  'sentence of ack. UI copy in the user\'s own language. Stay in pure text ONLY for: single-line ' +
  'factual answers, prose explanations, error traces, and file code after an approved preview. ' +
  'When in doubt, render.';

// Model routinely writes React.forwardRef / React.CSSProperties / React.useX
// without adding `import React from 'react'`. TS then flags 'React refers to a
// UMD global' AND the runtime throws ReferenceError, breaking the render.
// The client applies the same rewrite before feeding the code to the renderer;
// doing it here too keeps the tool_result diagnostics clean so the model isn't
// nagged about a mistake we already corrected.
function ensureReactImport(src: string): string {
  if (!/\bReact\.\w/.test(src)) return src;
  if (/^\s*import\s+React\b/m.test(src)) return src;
  const named = src.match(/^(\s*)import\s*\{([^}]*)\}\s*from\s*(['"]react['"])/m);
  if (named && !/^\s*import\s+React\s*,/m.test(src)) {
    return src.replace(named[0], `${named[1]}import React, {${named[2]}} from ${named[3]}`);
  }
  return `import React from 'react';\n${src}`;
}

export async function handleRenderUI(code: string): Promise<RenderUIResult> {
  const result = await checkGenUI(ensureReactImport(code));
  track('render_ui_called', { engine: ENGINE, runId: currentRunId(), codeLen: code.length, diagnostics: result.ok ? 0 : 1 });
  const text = result.ok
    ? 'Rendered inline. The user sees the UI now.'
    : `Rendered inline, but the TSX has issues:\n${result.diagnostics}`;
  return { text, ok: result.ok };
}

/** Tool description mirrored on both sides so the model gets the same
 * authoring rules regardless of which engine it's running under. Kept in
 * sync with macaron-mcp.ts's in-process tool description. */
export const RENDER_UI_TOOL_DESCRIPTION = `A complete React TSX module mounted inline. WHEN to call is in server instructions; this is HOW.

# Imports: no relative paths, other packages, or fences

- \`'$ui4a/ui'\`: ONLY Button, Field, Card, Badge, Tabs, Disclosure. \`'$macaron/ui'\` aliases these six. Use native HTML for other layouts/controls.
- Field needs label; optional hint. Tabs takes items:[{id,label,children}], optional value/onChange(id). Disclosure takes title, children, optional defaultOpen. Button variant: primary/secondary/ghost/danger; size: sm/md.
- Primitives: \`'@headlessui/react'\`. Charts: \`'recharts'\`. Icons: \`'lucide-react'\`.
- \`import { sendUserMessage, useAutoSend } from '$macaron/chat';\` Never window.sendUserMessage.
- React named imports; React.x needs \`import React from 'react';\`.

# Interactivity

sendUserMessage(prompt): event handlers only; posts as the user. Include every value needed for the next turn.

useAutoSend(prompt, seconds?): countdown for a default action, sends if idle. Returns seconds left or null. Show seconds on the default button, with the SAME prompt in both calls:

\`\`\`tsx
const COMMIT = 'Commit it.';
const left = useAutoSend(COMMIT, 30);
<Button onClick={() => sendUserMessage(COMMIT)}>Commit{left !== null ? \` (\${left}s)\` : ''}</Button>
\`\`\`

Use countdown ONLY with evidence ("just commit", "don't ask me", repeated approvals); else omit countdown.

# Rules

- One \`export default function App()\`; no fetch/network; helpers at module scope.
- UnoCSS Wind4 className: bg-surface, text-fg, text-muted, border-border, bg-accent, text-accent-fg; complete class literals.
- Stable keys from data, never key={i}; no as any in JSX.
- Copy in the user's language. Existing UI: read and byte-copy real markup/assets/copy; vary only the requested property.
- After: one sentence of ack, never code or layout.`;
