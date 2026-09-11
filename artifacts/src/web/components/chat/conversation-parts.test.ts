import { describe, expect, test } from 'bun:test';
import type { ChatMessage } from '../../../shared/types';
import { conversationParts } from './conversation-parts';
import { groupToolEntries, summarizeTools } from './tool-groups';

type Part = ChatMessage['parts'][number];
const tool = (toolCallId: string): Extract<Part, { type: 'dynamic-tool' }> => ({ type: 'dynamic-tool', toolName: 'exec_command', toolCallId, state: 'output-available', input: {}, output: '' });
const command = (toolCallId: string, output: string, id?: string): Extract<Part, { type: 'data-command' }> => ({ type: 'data-command', data: { toolCallId, output }, ...(id ? { id } : {}) });

describe('conversation parts', () => {
  test('joins interleaved command deltas per call without duplicating their tools', () => {
    const first = tool('first'), second = tool('second');
    const result = conversationParts([first, command('first', 'one'), second, command('second', 'alpha'), command('first', '\ntwo'), command('second', '\nbeta')], false);
    expect(result.outputs.get('first')).toBe('one\ntwo');
    expect(result.outputs.get('second')).toBe('alpha\nbeta');
    expect(result.entries).toEqual([{ part: first, index: 0 }, { part: second, index: 2 }]);
    expect(result.entries[0].part).toBe(first);
    const groups = groupToolEntries(result.entries);
    expect(groups).toHaveLength(1);
    if (groups[0].kind === 'tools') expect(summarizeTools(groups[0].parts).label).toBe('已调用 2 个工具');
  });

  test('replaces legacy cumulative output instead of concatenating the same prefix again', () => {
    const result = conversationParts([tool('command'), command('command', 'one', 'command:command'), command('command', 'one\ntwo', 'command:command'), command('command', '\nthree')], false);
    expect(result.outputs.get('command')).toBe('one\ntwo\nthree');
    expect(result.entries).toHaveLength(1);
  });

  test('suppresses orphan presentation even when the main tool arrives after its deltas', () => {
    const main = tool('command');
    const result = conversationParts([command('command', 'first'), command('command', ' second'), main], false);
    expect(result.entries).toEqual([{ part: main, index: 2 }]);
    expect(result.outputs.get('command')).toBe('first second');
  });

  test('renders orphan command streams once with their identity and complete output', () => {
    const parts: Part[] = [{ type: 'step-start' }, command('orphan', 'one'), command('orphan', '\ntwo')];
    const result = conversationParts(parts, false);
    expect(result.entries).toEqual([{ index: 1, part: { type: 'dynamic-tool', toolName: 'command', toolCallId: 'orphan', state: 'output-available', input: {}, output: 'one\ntwo' } }]);
    const streaming = conversationParts(parts, true);
    expect(streaming.entries).toHaveLength(1);
    expect(streaming.entries[0].part).toMatchObject({ type: 'dynamic-tool', toolCallId: 'orphan', state: 'input-available' });
    expect(streaming.outputs.get('orphan')).toBe('one\ntwo');
  });

  test('skips invisible metadata while preserving text, reasoning, approval, and image boundaries', () => {
    const parts: Part[] = [
      tool('a'),
      { type: 'data-usage', data: { inputTokens: 12 } },
      { type: 'step-start' },
      { type: 'data-artifact', data: { path: '.artifacts/canvases/example.ui4a.tsx', source: '', streaming: false, revision: 1 } },
      { type: 'data-recap', data: { suggestions: [] } },
      { type: 'text', text: ' \n ' },
      { type: 'file', mediaType: 'application/pdf', url: 'https://example.test/a.pdf' },
      tool('b'),
      { type: 'data-approval', data: { id: 'approval', tool: 'exec_command', input: {} } },
      tool('c'),
      { type: 'text', text: 'The answer.' },
      tool('d'),
      { type: 'reasoning', text: 'Inspect the source.', state: 'done' },
      { type: 'reasoning', text: 'Compare the result.', state: 'done' },
      tool('e'),
      { type: 'file', mediaType: 'image/png', url: 'https://example.test/a.png' },
      tool('f'),
    ];
    const result = conversationParts(parts, false);
    expect(result.entries.map(entry => entry.index)).toEqual([0, 7, 8, 9, 10, 11, 12, 14, 15, 16]);
    const groups = groupToolEntries(result.entries);
    expect(groups.map(group => group.kind === 'tools' ? group.parts.length : group.part.type)).toEqual([2, 'data-approval', 1, 'text', 1, 'reasoning', 1, 'file', 1]);
    expect(groups.flatMap(group => group.kind === 'tools' ? group.parts : [])).toHaveLength(6);
    expect(result.entries.find(entry => entry.index === 12)?.part).toBe(parts[12]);
  });

  test('retains resolved approvals as visible boundaries between tool groups', () => {
    const approval: Part = { type: 'data-approval', data: { id: 'approval', tool: 'exec_command', input: {}, resolved: true } };
    const result = conversationParts([tool('before'), approval, tool('after')], false);
    expect(groupToolEntries(result.entries).map(group => group.kind)).toEqual(['tools', 'part', 'tools']);
    expect(result.entries[1].part).toBe(approval);
  });
});
