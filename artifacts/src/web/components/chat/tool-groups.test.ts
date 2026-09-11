import { describe, expect, test } from 'bun:test';
import { groupToolEntries, isToolPart, summarizeTools, type ToolPartLike } from './tool-groups';

const tool = (name: string, state = 'output-available', extra: Partial<ToolPartLike> = {}): ToolPartLike => ({ type: `tool-${name}`, state, ...extra });

describe('tool groups', () => {
  test('recognizes static and dynamic calls without treating command data as another call', () => {
    expect(isToolPart(tool('Read'))).toBe(true);
    expect(isToolPart({ type: 'dynamic-tool', toolName: 'exec_command' })).toBe(true);
    for (const type of ['text', 'reasoning', 'data-command', 'data-approval', 'step-start']) expect(isToolPart({ type })).toBe(false);
  });

  test('groups adjacent calls while retaining visible content and approval boundaries', () => {
    const first = tool('Read'), second = tool('WebSearch');
    const parts = [first, second, { type: 'reasoning' }, tool('Write'), { type: 'text' }, tool('Edit'), { type: 'file' }, tool('Read'), { type: 'data-approval' }, tool('Read')];
    const groups = groupToolEntries(parts.map((part, index) => ({ part, index })));
    expect(groups.map(group => group.kind === 'tools' ? group.parts.length : group.part.type)).toEqual([2, 'reasoning', 1, 'text', 1, 'file', 1, 'data-approval', 1]);
    expect(groups[0]).toEqual({ kind: 'tools', parts: [first, second], index: 0 });
    if (groups[0].kind === 'tools') expect(groups[0].parts[0]).toBe(first);
  });

  test('keeps the first source index stable as a filtered stream appends calls', () => {
    const entries = [{ part: tool('Read'), index: 3 }, { part: tool('Grep'), index: 8 }];
    const before = groupToolEntries(entries);
    const after = groupToolEntries([...entries, { part: tool('WebSearch', 'input-streaming'), index: 15 }]);
    expect(before[0].index).toBe(3);
    expect(after[0].index).toBe(3);
    expect(after[0].kind === 'tools' && after[0].parts).toHaveLength(3);
  });

  test('does not mutate source entries, parts, or a previous grouping', () => {
    const first = Object.freeze(tool('Read'));
    const entries = Object.freeze([Object.freeze({ part: first, index: 1 })]);
    const before = groupToolEntries(entries);
    groupToolEntries([...entries, { part: tool('Write'), index: 2 }]);
    expect(before).toEqual([{ kind: 'tools', parts: [first], index: 1 }]);
    expect(entries).toHaveLength(1);
    expect(groupToolEntries([])).toEqual([]);
  });
});

describe('tool group summaries', () => {
  test('counts every invocation while summarizing known names and unfamiliar MCP calls', () => {
    const result = summarizeTools([tool('Read'), tool('Read'), tool('Bash', 'output-available', { input: { command: 'bun test' } }), { type: 'dynamic-tool', toolName: 'mcp__custom_server__inspect', state: 'output-available' }]);
    expect(result).toEqual({ label: '已调用 4 个工具', detail: '读取 2 · 运行命令 1 · inspect 1', working: false, failed: 0 });
  });

  test('shows the successful fraction while input and approved calls remain active', () => {
    const result = summarizeTools([tool('Read'), tool('Grep'), tool('Write', 'input-streaming'), tool('Bash', 'approval-responded')]);
    expect(result.label).toBe('正在调用工具 · 2/4');
    expect(result.working).toBe(true);
    expect(summarizeTools([tool('Read', 'input-available')]).label).toBe('正在调用工具 · 0/1');
  });

  test('keeps failed and denied tools visible and out of the successful count', () => {
    const failures = [tool('Read', 'output-error'), tool('Bash', 'output-denied')];
    expect(summarizeTools([tool('Write'), ...failures])).toMatchObject({ label: '3 个工具 · 2 项失败', working: false, failed: 2 });
    expect(summarizeTools([tool('Write'), ...failures, tool('Grep', 'input-available')])).toMatchObject({ label: '正在调用工具 · 1/4 · 2 项失败', working: true, failed: 2 });
    expect(summarizeTools([tool('Read', 'output-available', { errorText: 'Failed to read' })]).failed).toBe(1);
  });

  test('shows approvals and failures even when another tool is still running', () => {
    const parts = [tool('Read'), tool('Write', 'input-available'), tool('Bash', 'approval-requested'), tool('Grep', 'output-error')];
    expect(summarizeTools(parts)).toMatchObject({ label: '正在调用工具 · 1/4 · 1 项待确认 · 1 项失败', working: true, failed: 1 });
  });

  test('preserves pending approvals and incomplete legacy calls without claiming success', () => {
    expect(summarizeTools([tool('Read'), tool('Bash', 'approval-requested')])).toMatchObject({ label: '2 个工具 · 1 项待确认', working: true, failed: 0 });
    expect(summarizeTools([{ type: 'tool-Read' }])).toMatchObject({ label: '1 个工具 · 1 项未完成', working: false, failed: 0 });
    expect(summarizeTools([tool('Read', 'unknown')])).toMatchObject({ label: '1 个工具 · 1 项未完成', working: false, failed: 0 });
    expect(summarizeTools([])).toEqual({ label: '未调用工具', detail: '', working: false, failed: 0 });
  });

  test('stops running indicators for interrupted calls that never received a terminal result', () => {
    const parts = [tool('Read'), tool('Bash', 'input-available'), tool('Write', 'input-streaming'), tool('Grep', 'output-error')];
    expect(summarizeTools(parts, false)).toMatchObject({ label: '4 个工具 · 2 项未完成 · 1 项失败', working: false, failed: 1 });
    expect(summarizeTools([tool('Bash', 'approval-requested')], false)).toMatchObject({ label: '1 个工具 · 1 项未完成', working: false });
  });
});
