import { activityPresentation, toolActivities } from './tool-activity';

export type ToolPartLike = { type: string; toolName?: string; toolCallId?: string; state?: string; input?: unknown; errorText?: string };
export type ToolGroup<T> = { kind: 'tools'; parts: (T & ToolPartLike)[]; index: number } | { kind: 'part'; part: T; index: number };

export function isToolPart<T extends { type: string }>(part: T): part is T & ToolPartLike {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

export function groupToolEntries<T extends { type: string }>(entries: readonly { part: T; index: number }[]): ToolGroup<T>[] {
  const groups: ToolGroup<T>[] = [];
  for (const { part, index } of entries) {
    const previous = groups.at(-1);
    if (!isToolPart(part)) groups.push({ kind: 'part', part, index });
    else if (previous?.kind === 'tools') previous.parts.push(part);
    else groups.push({ kind: 'tools', parts: [part], index });
  }
  return groups;
}

const LABELS: Record<string, string> = {
  Read: '读取', read: '读取', read_file: '读取',
  Glob: '搜索', Grep: '搜索', WebSearch: '搜索', web_search: '搜索', web_search_exa: '搜索', github_code_search: '搜索代码',
  WebFetch: '获取网页', read_urls: '获取网页', web_fetch_exa: '获取网页',
  Write: '写入', write_file: '写入', Edit: '编辑', apply_patch: '编辑',
  Bash: '运行命令', exec_command: '运行命令', run_command: '运行命令', shell: '运行命令',
};

export function summarizeTools(parts: readonly ToolPartLike[], live = true): { label: string; detail: string; detailTitle?: string; working: boolean; failed: number } {
  const names = new Map<string, number>();
  const activities = parts.map(toolActivities);
  let succeeded = 0, failed = 0, active = 0, waiting = 0;
  for (const [index, part] of parts.entries()) {
    const raw = part.toolName ?? part.type.replace(/^tool-/, '');
    const name = raw.startsWith('mcp__') ? raw.split('__').slice(2).join('__') || raw : raw;
    const label = LABELS[name] ?? name;
    if (!activities[index]) names.set(label, (names.get(label) ?? 0) + 1);
    if (part.state === 'output-error' || part.state === 'output-denied' || part.errorText) failed++;
    else if (part.state === 'output-available') succeeded++;
    else if (part.state === 'approval-requested') waiting++;
    else if (part.state === 'input-streaming' || part.state === 'input-available' || part.state === 'approval-responded') active++;
  }
  const total = parts.length, unfinished = total - succeeded - failed;
  // Only an actual output counts as success; approval responses and legacy unknown states do not.
  let label = total ? `已调用 ${total} 个工具` : '未调用工具';
  if (live && active) label = `正在调用工具 · ${succeeded}/${total}`;
  else if (live && waiting) label = `${total} 个工具 · ${waiting} 项待确认`;
  else if (unfinished) label = `${total} 个工具 · ${unfinished} 项未完成`;
  else if (failed) label = `${total} 个工具`;
  if (live && active && waiting) label += ` · ${waiting} 项待确认`;
  if (failed) label += ` · ${failed} 项失败`;
  const presentation = activityPresentation(activities.flatMap(actions => actions ?? []));
  const specific = presentation && !names.size && presentation.label !== '调用工具' && !failed && !waiting && (succeeded === total || live && active);
  if (specific) label = succeeded === total ? `已${presentation.label}` : `正在${presentation.label} · ${succeeded}/${total}`;
  const prefix = presentation && !specific && !['探索', '调用工具'].includes(presentation.label) ? `${presentation.label} ` : '';
  const fallback = [...names].map(([name, count]) => `${name} ${count}`);
  const detail = [presentation ? prefix + presentation.detail : '', ...fallback].filter(Boolean).join(' · ');
  const title = [presentation ? prefix + presentation.title : '', ...fallback].filter(Boolean).join(' · ');
  return { label, detail, ...(title !== detail ? { detailTitle: title } : {}), working: live && active + waiting > 0, failed };
}
