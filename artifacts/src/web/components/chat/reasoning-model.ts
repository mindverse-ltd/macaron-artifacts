import type { ReasoningUIPart } from 'ai';
import { parseMarkdownIntoBlocks } from 'streamdown';

type ReasoningEntry = { key: string; text: string; streaming: boolean };
type ReasoningKind = 'summary' | 'full';

export function reasoningRunAt(parts: readonly { type: string }[], index: number): ReasoningUIPart[] | undefined {
  if (parts[index]?.type !== 'reasoning' || parts[index - 1]?.type === 'reasoning') return undefined;
  const run: ReasoningUIPart[] = [];
  for (let current = index; current < parts.length && parts[current].type === 'reasoning'; current++) run.push(parts[current] as ReasoningUIPart);
  return run;
}

function declaredKind(part: ReasoningUIPart): ReasoningKind | undefined {
  const kind = part.providerMetadata?.macaron?.reasoningKind;
  if (kind === 'summary' || kind === 'full') return kind;
  const legacy = /:(summary|content):\d+$/.exec(part.id ?? '')?.[1];
  return legacy === 'summary' ? 'summary' : legacy === 'content' ? 'full' : undefined;
}

function summaryEntries(part: ReasoningUIPart, partIndex: number, live: boolean) {
  const entries: ReasoningEntry[] = [];
  const prefix = part.id ?? `reasoning-${partIndex}`;
  let text = '';
  let leadingHeadingCount = 0;
  let headingsOnly = true;
  const flush = () => {
    if (text.trim()) entries.push({ key: `${prefix}:${entries.length}`, text: text.trim(), streaming: false });
    text = '';
  };
  const blocks = parseMarkdownIntoBlocks(part.text);
  for (const block of blocks) {
    // Parse block boundaries first so a code sample cannot become a thinking status.
    if (/^ {0,3}(?:`{3,}|~{3,})/.test(block) || /^ {4}\S/.test(block)) {
      headingsOnly = false;
      text += block;
      continue;
    }
    const lines = block.split(/(?<=\n)/);
    for (const line of lines) {
      if (/^ {0,3}(\*\*|__)(?=\S)((?:(?!\1).)+?)\1[\t ]*\r?\n?$/.test(line)) {
        flush();
        if (headingsOnly) leadingHeadingCount++;
        text = line;
      } else if (live && (/^ {0,3}(\*\*|__)(?:(?!\1)[^\n])*$/.test(line) || /^ {0,3}[*_]$/.test(line)) && block === blocks.at(-1) && line === lines.at(-1)) {
        // A streaming heading replaces the previous status only when its closing marker arrives.
        continue;
      } else {
        if (line.trim()) headingsOnly = false;
        text += line;
      }
    }
  }
  flush();
  // Earlier summaries are complete even when their containing provider part is still streaming.
  const latest = entries.at(-1);
  if (latest) latest.streaming = live && part.state === 'streaming';
  return { entries, leadingHeadingCount, headingsOnly };
}

export function analyzeReasoning(parts: readonly ReasoningUIPart[], live = false): { kind: ReasoningKind; entries: ReasoningEntry[] } {
  const nonempty = parts.flatMap((part, index) => part.text.trim() ? [{ part, index }] : []);
  const kinds = nonempty.map(({ part }) => declaredKind(part));
  const summaries = nonempty.map(({ part, index }, at) => kinds[at] === 'full' ? null : summaryEntries(part, index, live && part.state !== 'done'));
  let leadingHeadings = 0;
  for (const summary of summaries) { if (!summary) break; leadingHeadings += summary.leadingHeadingCount; if (!summary.headingsOnly) break; }
  // Once two leading statuses establish a summary, appended descriptions must not undo that evidence and replay its history. This also survives reloads.
  const kind = kinds.includes('full') ? 'full' : kinds.includes('summary') || leadingHeadings >= 2 ? 'summary' : 'full';
  const entries = nonempty.flatMap(({ part, index }, at) => {
    const summary = summaries[at];
    // A later full-thinking part changes the layout, not the identities of earlier summaries. Explicit full parts still bypass Markdown splitting.
    // Before a second status closes, use the same entries without claiming a summary yet; its partial text must not fade once as raw prose and again as a new status.
    if (summary && (kind === 'summary' || kinds[at] === 'summary' || summary.leadingHeadingCount >= 2 || (summary.leadingHeadingCount === 1 && summary.headingsOnly))) return summary.entries;
    return [{ key: `${part.id ?? `reasoning-${index}`}:0`, text: part.text, streaming: live && part.state === 'streaming' }];
  });
  return { kind, entries };
}
