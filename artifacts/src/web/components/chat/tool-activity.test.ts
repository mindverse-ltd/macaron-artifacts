import { describe, expect, test } from 'bun:test';
import { activityPresentation, toolActivities, toolName } from './tool-activity';
import { summarizeTools, type ToolPartLike } from './tool-groups';

const tool = (name: string, input: unknown, state = 'output-available'): ToolPartLike => ({ type: 'dynamic-tool', toolName: name, input, state });

describe('semantic tool descriptions', () => {
  test('normalizes tool names consistently and preserves malformed MCP names', () => {
    expect(toolName({ type: 'tool-Read' })).toBe('Read');
    expect(toolName(tool('mcp__server__read_file', {}))).toBe('read_file');
    expect(toolName(tool('mcp__server__', {}))).toBe('mcp__server__');
    expect(toolName(tool('mcp____Read', {}))).toBe('mcp____Read');
    expect(summarizeTools([tool('mcp__server__', {})]).detail).toBe('mcp__server__ 1');
  });

  test('uses native command actions and preserves search terms and paths', () => {
    const input = { command: 'opaque wrapper', cwd: '/workspace', commandActions: [
      { type: 'read', name: 'model.ts', path: '/workspace/src/model.ts', command: 'cat src/model.ts' },
      { type: 'search', query: 'RMSNorm', path: 'src', command: 'rg RMSNorm src' },
      { type: 'listFiles', path: null, command: 'ls' },
    ] };
    expect(toolActivities(tool('exec_command', input))).toEqual([
      { kind: 'read', target: '/workspace/src/model.ts' }, { kind: 'search', target: 'RMSNorm', path: 'src' }, { kind: 'list', target: '/workspace' },
    ]);
    const summary = summarizeTools([tool('exec_command', input)]);
    expect(summary.label).toBe('已探索');
    expect(summary.detail).toContain('RMSNorm');
    expect(summary.detail).toContain('model.ts');
  });

  test('does not relabel a native unknown or mixed command as a read', () => {
    expect(toolActivities(tool('exec_command', { command: 'cat file.ts', commandActions: [{ type: 'unknown', command: 'cat file.ts' }] }))).toBeUndefined();
    expect(toolActivities(tool('exec_command', { command: 'cat file.ts', commandActions: [{ type: 'read', path: 'file.ts' }, { type: 'unknown', command: 'bun test' }] }))).toBeUndefined();
    expect(toolActivities(tool('exec_command', { command: 'cat file.ts', commandActions: [] }))).toBeUndefined();
  });

  test('extracts structured files, queries, glob patterns and fetched pages', () => {
    expect(toolActivities(tool('Read', { file_path: 'src/model.ts', offset: 20 }))).toEqual([{ kind: 'read', target: 'src/model.ts' }]);
    expect(toolActivities(tool('Grep', { pattern: 'q_a|kv_a', path: 'src' }))).toEqual([{ kind: 'search', target: 'q_a|kv_a', path: 'src' }]);
    expect(toolActivities(tool('Glob', { pattern: '**/*.tsx', path: 'components' }))).toEqual([{ kind: 'search', target: '**/*.tsx', path: 'components' }]);
    expect(toolActivities(tool('mcp__exa__web_search_exa', { query: 'MLA dimensions' }))).toEqual([{ kind: 'search', target: 'MLA dimensions' }]);
    expect(toolActivities(tool('web_search', { queries: ['MLA', 'RMSNorm'] }))).toHaveLength(2);
    expect(toolActivities(tool('Read', { file_path: '' }))).toBeUndefined();
    const fetched = activityPresentation(toolActivities(tool('WebFetch', { url: 'https://user:password@example.com/docs?key=secret#section' }))!);
    expect(fetched?.detail).toBe('example.com/docs');
  });

  test('deduplicates display targets without collapsing distinct files or invocation counts', () => {
    const parts = [tool('Read', { file_path: 'src/model.ts' }), tool('Read', { file_path: 'src/model.ts' }), tool('Read', { file_path: 'test/model.ts' })];
    expect(summarizeTools(parts)).toMatchObject({ label: '已读取', detail: 'src/model.ts、test/model.ts' });
    expect(parts).toHaveLength(3);
  });

  test('preserves status and never describes failed or unfinished reads as completed', () => {
    const input = { file_path: 'src/model.ts' };
    expect(summarizeTools([tool('Read', input, 'input-streaming')])).toMatchObject({ label: '正在读取 · 0/1', detail: 'src/model.ts', working: true });
    for (const state of ['output-error', 'output-denied', 'approval-requested']) {
      const summary = summarizeTools([tool('Read', input, state)]);
      expect(summary.label).not.toContain('已读取');
      expect(summary.detail).toBe('读取 src/model.ts');
    }
    expect(summarizeTools([tool('Read', input, 'input-streaming')], false)).toMatchObject({ label: '1 个工具 · 1 项未完成', detail: '读取 src/model.ts', working: false });
  });

  test('shows the filename before a long path and preserves the full path in its tooltip', () => {
    const path = '/Users/example/Desktop/macaron/artifacts/src/web/components/chat/tool-activity.ts';
    const part = tool('exec_command', { command: 'cat source', commandActions: [{ type: 'read', path, name: 'tool-activity.ts' }] });
    const summary = summarizeTools([part]);
    expect(summary.detail.startsWith('tool-activity.ts')).toBe(true);
    expect(summary.detailTitle).toBe(path);
    expect(toolActivities(part)?.[0].target).toBe(path);
  });

  test('keeps mixed writes and unknown commands explicit', () => {
    const parts = [tool('Read', { file_path: 'src/model.ts' }), tool('Bash', { command: 'cat package.json && bun test' })];
    expect(summarizeTools(parts)).toMatchObject({ label: '已调用 2 个工具', detail: '读取 src/model.ts · 运行命令 1' });
    expect(summarizeTools([tool('Edit', { file_path: 'src/model.ts' })]).label).toBe('已编辑');
    expect(summarizeTools([parts[0], tool('Edit', { file_path: 'src/model.ts' })]).label).toBe('已调用 2 个工具');
  });
});
