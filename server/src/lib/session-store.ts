import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  Block,
  Message,
  SessionDetail,
  SessionListItem,
  Workspace,
} from '@macaron/shared';
import { CLAUDE_PROJECTS } from '../config.js';

export function basename(p: string): string {
  if (!p) return '';
  return p.split('/').filter(Boolean).pop() || p;
}

export function decodeClaudeProjectName(encoded: string): string {
  return encoded.replace(/^-/, '/').replace(/-/g, '/');
}

type SessionSummary = {
  firstUserText: string;
  cwd: string;
  gitBranch: string;
  headLines: number;
  truncated: boolean;
  mtime: number;
  size: number;
};

type CacheEntry = { mtimeMs: number; size: number; summary: SessionSummary };

// File-keyed mtime cache so we only re-parse jsonl when claude appends to it.
const summaryCache = new Map<string, CacheEntry>();
const HEAD_BYTES = 96 * 1024;

export async function deleteSession(project: string, sid: string): Promise<void> {
  const filePath = path.join(CLAUDE_PROJECTS, project, `${sid}.jsonl`);
  await fs.unlink(filePath);
  summaryCache.delete(filePath);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function readSessionSummary(filePath: string): Promise<SessionSummary | null> {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch {
    return null;
  }

  const cached = summaryCache.get(filePath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.summary;
  }

  const summary: SessionSummary = {
    firstUserText: '',
    cwd: '',
    gitBranch: '',
    headLines: 0,
    truncated: st.size > HEAD_BYTES,
    mtime: st.mtimeMs,
    size: st.size,
  };

  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const len = Math.min(st.size, HEAD_BYTES);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      const text = buf.toString('utf8');
      const lines = text.split('\n');
      const upto = summary.truncated ? lines.length - 1 : lines.length;
      for (let i = 0; i < upto; i++) {
        const line = lines[i]!;
        if (!line.trim()) continue;
        summary.headLines++;
        if (summary.firstUserText && summary.cwd) continue;
        try {
          const o = JSON.parse(line);
          if (!summary.cwd && o.cwd) summary.cwd = o.cwd;
          if (!summary.gitBranch && o.gitBranch) summary.gitBranch = o.gitBranch;
          if (!summary.firstUserText && o.type === 'user' && o.message?.content) {
            const c = o.message.content;
            const t =
              typeof c === 'string'
                ? c
                : Array.isArray(c)
                  ? c.map((b: { text?: string }) => b.text || '').join(' ')
                  : '';
            if (t && !t.startsWith('<') && !t.includes('tool_result')) summary.firstUserText = t;
          }
        } catch {
          /* skip malformed line */
        }
      }
    } finally {
      await fh.close();
    }
  } catch {
    /* swallow */
  }

  summaryCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, summary });
  return summary;
}

export async function listAllSessions(): Promise<SessionListItem[]> {
  let projects;
  try {
    projects = await fs.readdir(CLAUDE_PROJECTS, { withFileTypes: true });
  } catch {
    return [];
  }

  type Target = { project: string; file: string; sid: string };
  const targets: Target[] = [];
  await mapPool(
    projects.filter((p) => p.isDirectory()),
    16,
    async (p) => {
      const projDir = path.join(CLAUDE_PROJECTS, p.name);
      let files;
      try {
        files = await fs.readdir(projDir);
      } catch {
        return;
      }
      for (const f of files) {
        if (f.endsWith('.jsonl')) {
          targets.push({ project: p.name, file: path.join(projDir, f), sid: f.slice(0, -6) });
        }
      }
    },
  );

  const summaries = await mapPool(targets, 32, async (t): Promise<SessionListItem | null> => {
    const meta = await readSessionSummary(t.file);
    if (!meta) return null;
    const item: SessionListItem = {
      kind: 'claude',
      project: t.project,
      cwd: meta.cwd || decodeClaudeProjectName(t.project),
      gitBranch: meta.gitBranch || undefined,
      sessionId: t.sid,
      preview: (meta.firstUserText || '').slice(0, 220),
      messageCount: meta.headLines,
      messageCountSuffix: meta.truncated ? '+' : '',
      mtime: meta.mtime,
      size: meta.size,
      resumeCommand: `claude --resume ${t.sid}`,
    };
    return item;
  });

  const out = summaries.filter((s): s is SessionListItem => s !== null);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export function groupWorkspaces(sessions: SessionListItem[]): Workspace[] {
  const byCwd = new Map<string, Workspace>();
  for (const s of sessions) {
    const key = s.cwd || s.project;
    if (!byCwd.has(key)) {
      byCwd.set(key, {
        cwd: s.cwd,
        project: s.project,
        name: basename(s.cwd) || s.project,
        sessionCount: 0,
        lastActivity: 0,
        lastSessionId: '',
        lastPreview: '',
      });
    }
    const w = byCwd.get(key)!;
    w.sessionCount++;
    if (s.mtime > w.lastActivity) {
      w.lastActivity = s.mtime;
      w.lastSessionId = s.sessionId;
      w.lastPreview = s.preview;
      w.project = s.project;
    }
  }
  const arr = Array.from(byCwd.values());
  arr.sort((a, b) => b.lastActivity - a.lastActivity);
  return arr;
}

const SESSION_TAIL_BYTES = 8 * 1024 * 1024;

export async function readSessionMessages(project: string, sid: string): Promise<SessionDetail> {
  const filePath = path.join(CLAUDE_PROJECTS, project, `${sid}.jsonl`);
  const st = await fs.stat(filePath);
  let raw: string;
  let truncated = false;
  if (st.size > SESSION_TAIL_BYTES) {
    truncated = true;
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(SESSION_TAIL_BYTES);
      await fh.read(buf, 0, SESSION_TAIL_BYTES, st.size - SESSION_TAIL_BYTES);
      raw = buf.toString('utf8');
      const nl = raw.indexOf('\n');
      if (nl !== -1) raw = raw.slice(nl + 1);
    } finally {
      await fh.close();
    }
  } else {
    raw = await fs.readFile(filePath, 'utf8');
  }
  const messages: Message[] = [];
  let cwd = '';
  let gitBranch = '';
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (!cwd && o.cwd) cwd = o.cwd;
      if (!gitBranch && o.gitBranch) gitBranch = o.gitBranch;
      if (o.type === 'user' || o.type === 'assistant') {
        // Skip meta-injected messages like the synthetic "Continue from where
        // you left off." that claude-cli writes when resuming sessions.
        if (o.isMeta) continue;
        const blocks: Block[] = [];
        const c = o.message?.content;
        if (typeof c === 'string') {
          blocks.push({ kind: 'text', text: c });
        } else if (Array.isArray(c)) {
          for (const b of c) {
            if (b.type === 'text' && b.text) blocks.push({ kind: 'text', text: b.text });
            else if (b.type === 'thinking' && b.thinking)
              blocks.push({ kind: 'thinking', text: b.thinking });
            else if (b.type === 'tool_use')
              blocks.push({ kind: 'tool_use', id: b.id, name: b.name, input: b.input });
            else if (b.type === 'image' && b.source?.type === 'base64' && b.source?.data) {
              // The CLI persists user-attached images as base64 in the
              // jsonl. Ship them through so the WebUI can render inline
              // where they appear (preserving interleaved order with text).
              blocks.push({
                kind: 'image',
                mimeType: String(b.source.media_type || 'image/png'),
                data: String(b.source.data),
              });
            }
            else if (b.type === 'tool_result') {
              const t =
                typeof b.content === 'string'
                  ? b.content
                  : Array.isArray(b.content)
                    ? b.content.map((x: { text?: string }) => x.text || '').join('\n')
                    : '';
              blocks.push({ kind: 'tool_result', toolUseId: b.tool_use_id, text: t.slice(0, 4000) });
            }
          }
        }
        messages.push({
          role: o.type,
          blocks,
          model: o.message?.model,
          timestamp: o.timestamp,
          uuid: o.uuid,
        });
      }
    } catch {
      /* skip malformed */
    }
  }
  return { sessionId: sid, project, cwd, gitBranch, messages, truncated, totalBytes: st.size };
}
