import { parseCommandActivities, type CommandActivity } from './command-activity';
import type { ToolPartLike } from './tool-groups';

export type ToolActivity = Omit<CommandActivity, 'kind'> & { kind: CommandActivity['kind'] | 'fetch' | 'write' | 'edit' };
const LABELS = { read: '读取', search: '搜索', list: '查看目录', fetch: '获取网页', write: '写入', edit: '编辑' };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
export const toolName = (part: ToolPartLike) => (part.toolName ?? part.type.replace(/^tool-/, '')).replace(/^mcp__[^]+?__/, '');

export function toolActivities(part: ToolPartLike): ToolActivity[] | undefined {
  const input = record(part.input), name = toolName(part), path = text(input.file_path ?? input.filePath ?? input.path ?? input.filename);
  if (['exec_command', 'Bash', 'shell', 'run_command', 'command'].includes(name)) {
    if (!Array.isArray(input.commandActions)) return parseCommandActivities(input.command ?? input.cmd);
    // Native classifications are display metadata, not a read-only permission guarantee.
    const actions: ToolActivity[] = [];
    for (const value of input.commandActions) {
      const action = record(value), target = text(action.path);
      if (action.type === 'read' && (target || text(action.name))) actions.push({ kind: 'read', target: target || text(action.name) });
      else if (action.type === 'listFiles') actions.push({ kind: 'list', target: target || text(input.cwd) || '.' });
      else if (action.type === 'search' && text(action.query)) actions.push({ kind: 'search', target: text(action.query), ...(target ? { path: target } : {}) });
      else return undefined;
    }
    return actions.length ? actions : undefined;
  }
  if (['Read', 'read', 'read_file'].includes(name) && path) return [{ kind: 'read', target: path }];
  if (['Write', 'write_file', 'Edit'].includes(name) && path) return [{ kind: name === 'Edit' ? 'edit' : 'write', target: path }];
  if (name === 'apply_patch' && Array.isArray(input.changes)) {
    const paths = input.changes.map(value => text(record(value).path));
    if (paths.length && paths.every(Boolean)) return paths.map(target => ({ kind: 'edit', target }));
  }
  if (['list_directory', 'list_files'].includes(name) && path) return [{ kind: 'list', target: path }];
  if (['Grep', 'Glob', 'WebSearch', 'web_search', 'web_search_exa', 'github_code_search'].includes(name)) {
    const queries = Array.isArray(input.queries) ? input.queries.map(text) : [text(input.query ?? input.pattern)];
    if (queries.length && queries.every(Boolean)) return queries.map(target => ({ kind: 'search', target, ...(path ? { path } : {}) }));
  }
  if (['WebFetch', 'read_urls', 'web_fetch_exa'].includes(name) || name === 'web_search' && input.type === 'openPage') {
    const urls = Array.isArray(input.urls) ? input.urls.map(text) : [text(input.url)];
    if (urls.length && urls.every(Boolean)) return urls.map(target => ({ kind: 'fetch', target }));
  }
  return undefined;
}

function displayPath(path: string, compact: boolean): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return compact && path.length > 36 && separator > 0 && separator < path.length - 1 ? `${path.slice(separator + 1)}（${path.slice(0, separator)}）` : path;
}

function displayTarget(action: ToolActivity, compact = true): string {
  if (action.kind === 'search') return `“${action.target}”${action.path ? `（${displayPath(action.path, compact)}）` : ''}`;
  if (action.kind === 'fetch') {
    try { const url = new URL(action.target); return `${url.host}${url.pathname === '/' ? '' : url.pathname}`; } catch { return action.target; }
  }
  return displayPath(action.target, compact);
}

/** Deduplicate display targets without losing distinct full paths or changing the underlying call count. */
export function activityPresentation(actions: readonly ToolActivity[]): { label: string; detail: string; title: string } | undefined {
  if (!actions.length) return undefined;
  const groups = new Map<ToolActivity['kind'], Map<string, ToolActivity>>();
  for (const action of actions) {
    const targets = groups.get(action.kind) ?? new Map<string, ToolActivity>();
    targets.set(JSON.stringify([action.target, action.path]), action); groups.set(action.kind, targets);
  }
  const descriptions = [...groups].map(([kind, targets]) => ({ label: LABELS[kind], detail: [...targets.values()].map(action => displayTarget(action)).join('、'), title: [...targets.values()].map(action => displayTarget(action, false)).join('、') }));
  if (descriptions.length === 1) return descriptions[0];
  return { label: [...groups.keys()].every(kind => kind !== 'write' && kind !== 'edit') ? '探索' : '调用工具', detail: descriptions.map(item => `${item.label} ${item.detail}`).join(' · '), title: descriptions.map(item => `${item.label} ${item.title}`).join(' · ') };
}
