import { describe, expect, test } from 'bun:test';
import type { ReasoningUIPart } from 'ai';
import { analyzeReasoning, reasoningRunAt } from './reasoning-model';

const part = (text: string, extra: Partial<ReasoningUIPart> = {}): ReasoningUIPart => ({ type: 'reasoning', text, ...extra });
const summary = (text: string, extra: Partial<ReasoningUIPart> = {}) => part(text, { providerMetadata: { macaron: { reasoningKind: 'summary' } }, ...extra });

describe('reasoning presentation', () => {
  test('groups only adjacent parts without erasing their identities or crossing an answer or tool', () => {
    const first = part('First block', { id: 'first' });
    const second = part('Second block', { id: 'second' });
    const third = part('Third block', { id: 'third' });
    const parts = [first, second, { type: 'tool-read' }, third, { type: 'text' }, part('Fourth block')];
    expect(reasoningRunAt(parts, 0)).toEqual([first, second]);
    expect(reasoningRunAt(parts, 0)?.[0]).toBe(first);
    expect(reasoningRunAt(parts, 1)).toBeUndefined();
    expect(reasoningRunAt(parts, 2)).toBeUndefined();
    expect(reasoningRunAt(parts, 3)).toEqual([third]);
    expect(reasoningRunAt(parts, 5)).toHaveLength(1);
  });

  test('keeps raw full reasoning and separate provider blocks intact', () => {
    const texts = ['  Inspect the constraints.\n\nThen compare both paths.  ', 'A separate block after an unseen reasoning gap.'];
    const result = analyzeReasoning(texts.map((text, index) => part(text, { id: `block-${index}` })));
    expect(result.kind).toBe('full');
    expect(result.entries.map((entry) => entry.text)).toEqual(texts);
    expect(result.entries.map((entry) => entry.key)).toEqual(['block-0:0', 'block-1:0']);
  });

  test('keeps descriptions with their summary heading and retains history across parts', () => {
    const result = analyzeReasoning([
      summary('**Inspecting the existing code**\n\nRead both implementations before changing the presentation.\n\n**Comparing the rendering paths**\n\nCheck which events preserve the summary.', { id: 'one' }),
      summary('**Preparing the final patch**', { id: 'two' }),
    ]);
    expect(result.kind).toBe('summary');
    expect(result.entries.map((entry) => entry.text)).toEqual([
      '**Inspecting the existing code**\n\nRead both implementations before changing the presentation.',
      '**Comparing the rendering paths**\n\nCheck which events preserve the summary.',
      '**Preparing the final patch**',
    ]);
    expect(new Set(result.entries.map((entry) => entry.key)).size).toBe(3);
  });

  test('does not replace the previous summary while the next heading is incomplete', () => {
    const previous = '**Inspecting the source**\n\nThe implementation is under review.';
    const next = '**Comparing the rendering paths**';
    const stable = analyzeReasoning([summary(previous)]).entries.at(-1);
    for (let length = 1; length < next.length; length++) {
      expect(analyzeReasoning([summary(`${previous}\n\n${next.slice(0, length)}`)], true).entries.at(-1)).toEqual(stable);
    }
    expect(analyzeReasoning([summary(`${previous}\n\n${next}`)]).entries.at(-1)?.text).toBe(next);
  });

  test('keeps inferred summary compact during a new heading but preserves interrupted text', () => {
    const complete = '**Inspecting the source**\n\n**Comparing the rendering paths**';
    const next = '**Preparing the final patch**';
    for (let length = 1; length < next.length; length++) {
      const result = analyzeReasoning([part(`${complete}\n\n${next.slice(0, length)}`)], true);
      expect(result.kind).toBe('summary');
      expect(result.entries.at(-1)?.text).toBe('**Comparing the rendering paths**');
      const separate = analyzeReasoning([part(complete), part(next.slice(0, length), { state: 'streaming' })], true);
      expect(separate.kind).toBe('summary');
      expect(separate.entries.at(-1)?.text).toBe('**Comparing the rendering paths**');
    }
    const interrupted = `${complete}\n\n**Preparing the`;
    expect(analyzeReasoning([part(interrupted)]).entries.map(entry => entry.text).join('\n\n')).toBe(interrupted);
    expect(analyzeReasoning([summary(interrupted)]).entries.at(-1)?.text).toContain('**Preparing the');
    expect(analyzeReasoning([summary(interrupted, { state: 'done' })], true).entries.at(-1)?.text).toContain('**Preparing the');
  });

  test('infers summary only from multiple standalone headings and respects explicit full metadata', () => {
    expect(analyzeReasoning([part('**One heading**')]).kind).toBe('full');
    expect(analyzeReasoning([part('**One heading**\n**Another heading**')]).kind).toBe('summary');
    expect(analyzeReasoning([part('**One heading**'), part('**Another heading**')]).kind).toBe('summary');
    expect(analyzeReasoning([part('**One heading**\n\nSome explanation.\n\n**Another heading**')]).kind).toBe('full');
    expect(analyzeReasoning([part('**One heading** and **some prose**\n\n**Another heading**')]).kind).toBe('full');
    expect(analyzeReasoning([part('**One heading**\n\n**Another heading**', { providerMetadata: { macaron: { reasoningKind: 'full' } } })]).kind).toBe('full');
  });

  test('honors known legacy IDs and lets explicit metadata override them', () => {
    expect(analyzeReasoning([part('A plain summary.', { id: 'turn:item:summary:0' })]).kind).toBe('summary');
    expect(analyzeReasoning([part('**One heading**\n\n**Another heading**', { id: 'turn:item:content:0' })]).kind).toBe('full');
    expect(analyzeReasoning([summary('A plain summary.', { id: 'turn:item:content:0' })]).kind).toBe('summary');
  });

  test('does not interpret headings in fenced code as new status entries', () => {
    const text = '**Inspecting the example**\n\n```markdown\n**This is example code**\n```\n\n**Checking the result**';
    const result = analyzeReasoning([summary(text)]);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].text).toContain('```markdown\n**This is example code**\n```');
    expect(analyzeReasoning([part('```markdown\n**One heading**\n**Another heading**\n```')]).kind).toBe('full');
  });

  test('ignores empty completed blocks without hiding earlier content', () => {
    const result = analyzeReasoning([summary('**Inspecting the source**'), summary('', { state: 'done' }), part(' \n ', { state: 'done' })]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].text).toBe('**Inspecting the source**');
    expect(analyzeReasoning([part('', { state: 'done' })])).toEqual({ kind: 'full', entries: [] });
  });
  test('animates only explicit streaming parts of the active turn', () => {
    const parts = [part('Completed block', { state: 'done' }), part('Older import'), part('New block', { state: 'streaming' })];
    expect(analyzeReasoning(parts, true).entries.map(entry => entry.streaming)).toEqual([false, false, true]);
    expect(analyzeReasoning(parts, false).entries.every(entry => !entry.streaming)).toBe(true);
  });

  test('keeps older summaries static within and across provider parts', () => {
    const parts = [summary('**Completed block**', { state: 'done' }), summary('**Prior status**\n\nDescription.\n\n**Latest status**\n\nNew description.', { state: 'streaming' })];
    const result = analyzeReasoning(parts, true);
    expect(result.entries.map(entry => entry.streaming)).toEqual([false, false, true]);
    expect(analyzeReasoning(parts, false).entries.every(entry => !entry.streaming)).toBe(true);
    expect(analyzeReasoning(parts.map(part => ({ ...part, state: 'done' as const })), true).entries.every(entry => !entry.streaming)).toBe(true);
  });

  test('leading summary evidence and keys survive appended descriptions, completion and reload', () => {
    const first = '**First status**', second = '**Second status**', description = '\n\nNow checking sources.';
    const initial = analyzeReasoning([part(first, { id: 'r1', state: 'streaming' })], true);
    const headings = analyzeReasoning([part(`${first}\n\n${second}`, { id: 'r1', state: 'streaming' })], true);
    expect(initial.entries[0].key).toBe(headings.entries[0].key);
    for (let length = 1; length <= description.length; length++) {
      const text = `${first}\n\n${second}${description.slice(0, length)}`;
      const current = analyzeReasoning([part(text, { id: 'r1', state: 'streaming' })], true);
      expect(current.kind).toBe('summary'); expect(current.entries.map(entry => entry.key)).toEqual(headings.entries.map(entry => entry.key));
      expect(current.entries[0].streaming).toBe(false); expect(current.entries.at(-1)?.streaming).toBe(true);
      expect(analyzeReasoning([part(text, { id: 'r1', state: 'done' })]).kind).toBe('summary');
    }
    expect(analyzeReasoning([part(`${first}\n\nDescription before a second status.\n\n${second}`)]).kind).toBe('full');
  });

  test('waits for the second inferred status to close without delaying raw full reasoning or losing interrupted text', () => {
    const first = '**First status**', second = '**Second status**';
    for (let length = 1; length < second.length; length++) {
      const text = `${first}\n\n${second.slice(0, length)}`, current = part(text, { id: 'r1', state: 'streaming' });
      const pending = analyzeReasoning([current], true);
      expect(pending.kind).toBe('full'); expect(pending.entries).toEqual([{ key: 'r1:0', text: first, streaming: true }]);
      expect(analyzeReasoning([current], false).entries.map(entry => entry.text).join('\n\n')).toBe(text);
      expect(analyzeReasoning([{ ...current, providerMetadata: { macaron: { reasoningKind: 'full' } } }], true).entries[0].text).toBe(text);
      const prose = `${first}\n\nAn explanation.\n\n${second.slice(0, length)}`;
      expect(analyzeReasoning([part(prose, { state: 'streaming' })], true).entries[0].text).toBe(prose);
    }
  });

  test('summary prefix can span provider parts without counting headings after prose', () => {
    expect(analyzeReasoning([part('**First**'), part('**Second**\n\nDescription.')]).kind).toBe('summary');
    expect(analyzeReasoning([part('**First**\n\nDescription.'), part('**Second**')]).kind).toBe('full');
    expect(analyzeReasoning([part('Some prose.'), part('**First**\n\n**Second**')]).kind).toBe('full');
  });

  test('a later explicit full part keeps existing summary entries instead of merging their history', () => {
    const previous = part('**First**\n\n**Second**\n\nDescription.', { id: 'prior', state: 'done' });
    const before = analyzeReasoning([previous]);
    const raw = part('**Raw heading**\n\n**Another raw heading**', { id: 'raw', state: 'streaming', providerMetadata: { macaron: { reasoningKind: 'full' } } });
    const after = analyzeReasoning([previous, raw], true);
    expect(after.kind).toBe('full'); expect(after.entries.slice(0, 2)).toEqual(before.entries);
    expect(after.entries.at(-1)).toEqual({ key: 'raw:0', text: raw.text, streaming: true });
  });

});
