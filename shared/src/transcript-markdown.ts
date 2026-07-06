import type { Block, Message, SessionDetail } from './types.js';

// Serialize a parsed session transcript to a single clean Markdown document —
// the same `Message[]` the WebUI already holds, rendered for pasting into a
// PR, issue or doc. Pure and side-effect free: no DOM, no I/O, never throws.
// OpenCode's `/export` is the reference behavior.

function slugTitle(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max).trimEnd() + '…';
}

// Pick a fence long enough that nothing inside can break out of it. CommonMark
// lets an opening fence be closed only by a run of >= as many backticks, so we
// use one more than the longest run present in the body.
function fenceFor(body: string): string {
  let longest = 0;
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function codeFence(body: string, lang = ''): string {
  const fence = fenceFor(body);
  return `${fence}${lang}\n${body.replace(/\n+$/, '')}\n${fence}`;
}

// A one-line hint for the tool-call header, e.g. `Read · foo.ts` or
// `Bash · npm run build`. Falls back to nothing when no obvious field fits.
function toolHint(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const key = ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'prompt'].find(
    (k) => typeof o[k] === 'string' && o[k],
  );
  if (!key) return '';
  return slugTitle(String(o[key]), 72);
}

function toolInputJson(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

// tool_use + its paired tool_result render as one collapsed <details>.
function renderToolUse(
  block: Extract<Block, { kind: 'tool_use' }>,
  result: string | undefined,
): string {
  const hint = toolHint(block.input);
  const summary = `🔧 ${block.name}${hint ? ` · ${hint}` : ''}`;
  const parts = [`<details>`, `<summary>${summary}</summary>`, ''];
  parts.push('**Input**', '', codeFence(toolInputJson(block.input), 'json'), '');
  if (result != null && result.trim()) parts.push('**Result**', '', codeFence(result), '');
  parts.push(`</details>`);
  return parts.join('\n');
}

function renderMessage(m: Message, resultByToolId: Map<string, string>): string {
  const out: string[] = [];
  for (const b of m.blocks) {
    switch (b.kind) {
      case 'text':
        if (b.text.trim()) out.push(b.text.trim(), '');
        break;
      case 'thinking':
        if (b.text.trim())
          out.push('<details>', '<summary>💭 Thinking</summary>', '', b.text.trim(), '</details>', '');
        break;
      case 'tool_use':
        out.push(renderToolUse(b, resultByToolId.get(b.id)), '');
        break;
      case 'tool_result':
        // Only surface results not already merged into their tool_use above
        // (unpaired results are rare but keep them rather than drop context).
        if ((!b.toolUseId || !resultByToolId.has(b.toolUseId)) && b.text.trim())
          out.push('<details>', '<summary>🔧 Tool result</summary>', '', codeFence(b.text), '</details>', '');
        break;
      case 'image':
        out.push(`_[image: ${b.mimeType}, ${Math.round(b.data.length / 1024)} KB]_`, '');
        break;
      case 'system_event':
        out.push(`> ※ ${b.text.replace(/\n/g, ' ').trim()}`, '');
        break;
    }
  }
  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // A message whose only blocks were tool_results already merged upstream
  // renders empty — skip it (and its role header) rather than emit a bare
  // "### User" with nothing under it.
  if (!body) return '';
  const header = m.role === 'user' ? '### 🧑 User' : m.role === 'assistant' ? '### 🤖 Assistant' : '';
  return (header ? header + '\n\n' : '') + body;
}

export function sessionToMarkdown(detail: SessionDetail): string {
  // Pre-index every tool_result by the tool_use it answers so each call and
  // its output render together (mirrors the WebUI's paired rendering). Only
  // pair a result to a tool_use that actually exists — a rare orphan result
  // (no matching call) still renders standalone rather than vanishing.
  const toolUseIds = new Set<string>();
  for (const m of detail.messages)
    for (const b of m.blocks) if (b.kind === 'tool_use') toolUseIds.add(b.id);
  const resultByToolId = new Map<string, string>();
  for (const m of detail.messages)
    for (const b of m.blocks)
      if (b.kind === 'tool_result' && b.toolUseId && toolUseIds.has(b.toolUseId) && !resultByToolId.has(b.toolUseId))
        resultByToolId.set(b.toolUseId, b.text);

  const firstUserText =
    detail.messages
      .find((m) => m.role === 'user' && m.blocks.some((b) => b.kind === 'text' && b.text.trim()))
      ?.blocks.find((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text' && !!b.text.trim())
      ?.text ?? '';
  const model = detail.messages.find((m) => m.model)?.model;

  const title = firstUserText ? slugTitle(firstUserText) : `Session ${detail.sessionId.slice(0, 8)}`;
  const meta = [
    `\`${detail.sessionId}\``,
    detail.cwd ? `**cwd** \`${detail.cwd}\`` : '',
    detail.gitBranch ? `**branch** \`${detail.gitBranch}\`` : '',
    model ? `**model** \`${model}\`` : '',
  ].filter(Boolean);

  const head = [
    `# ${title}`,
    '',
    `> ${meta.join(' · ')}`,
    `> Exported from macaron · ${detail.messages.length} messages${detail.truncated ? ' · _transcript truncated (older messages omitted)_' : ''}`,
    '',
    '---',
    '',
  ];

  const body = detail.messages
    .map((m) => renderMessage(m, resultByToolId))
    .filter((s) => s.trim())
    .join('\n\n');

  return head.join('\n') + body + '\n';
}
