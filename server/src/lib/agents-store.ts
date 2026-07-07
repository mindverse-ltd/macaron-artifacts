// Custom subagent CRUD, backed by ~/.claude/agents/<name>.md.
//
// Each file is YAML frontmatter (name/description/tools/model/…) followed by
// the system-prompt body. Claude Code scans this dir at user scope and spawns
// the agent when the main loop calls the Agent tool with a matching
// subagent_type. We read/write the small, well-known subset of frontmatter
// keys the UI edits and pass through any others untouched.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentFile } from '@macaron/shared';
import { CLAUDE_AGENTS } from '../config.js';

// A subagent name maps 1:1 to a filename; keep it to the same charset Claude
// Code accepts (lowercase, digits, hyphens) so we never write a path that the
// CLI then refuses to load.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isValidAgentName(name: string): boolean {
  return NAME_RE.test(name);
}

function agentPath(name: string): string {
  return path.join(CLAUDE_AGENTS, `${name}.md`);
}

// Split a raw .md into { frontmatter lines, body }. Missing/blank frontmatter
// yields empty maps so a hand-written file without `---` fences still loads
// (body-only = system prompt with no metadata).
function parse(raw: string, name: string): AgentFile {
  const fm: Record<string, string> = {};
  let body = raw;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (m) {
    body = m[2] ?? '';
    for (const line of (m[1] ?? '').split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) fm[key] = val;
    }
  }
  const tools = (fm.tools || '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return {
    name,
    description: fm.description || '',
    tools,
    model: fm.model || '',
    prompt: body.replace(/^\r?\n/, ''),
  };
}

// Re-emit frontmatter + body. Only writes keys the UI owns; `tools` is dropped
// when empty so the agent inherits all tools (Claude Code's default).
function serialize(a: AgentFile): string {
  const lines = ['---', `name: ${a.name}`, `description: ${a.description}`];
  if (a.tools.length) lines.push(`tools: ${a.tools.join(', ')}`);
  if (a.model) lines.push(`model: ${a.model}`);
  lines.push('---', '');
  return lines.join('\n') + a.prompt.replace(/^\n+/, '') + '\n';
}

export async function listAgents(): Promise<AgentFile[]> {
  let entries;
  try {
    entries = await fs.readdir(CLAUDE_AGENTS, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: AgentFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const name = e.name.slice(0, -3);
    try {
      out.push(parse(await fs.readFile(path.join(CLAUDE_AGENTS, e.name), 'utf8'), name));
    } catch {
      /* skip unreadable file */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function readAgent(name: string): Promise<AgentFile | null> {
  try {
    return parse(await fs.readFile(agentPath(name), 'utf8'), name);
  } catch {
    return null;
  }
}

export async function writeAgent(a: AgentFile): Promise<AgentFile> {
  await fs.mkdir(CLAUDE_AGENTS, { recursive: true });
  await fs.writeFile(agentPath(a.name), serialize(a), 'utf8');
  return a;
}

export async function deleteAgent(name: string): Promise<boolean> {
  try {
    await fs.unlink(agentPath(name));
    return true;
  } catch {
    return false;
  }
}
