// Thin wrapper around the `git` CLI for the WebUI git panel. Every call is
// execFile (argv array, shell:false) so file names / branch names / commit
// messages can never be shell-interpreted — no injection surface. All commands
// run in a workspace cwd resolved from the claude project name.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitFileStatus, GitStatus, GitBranches } from '@macaron/shared';
import { CLAUDE_PROJECTS } from '../config.js';
import { decodeClaudeProjectName, readSessionSummary } from './session-store.js';

const pExecFile = promisify(execFile);

// Same cwd derivation the /api/workspaces POST uses: decode the project name
// (claude-cli encodes the cwd into it), then prefer the real cwd embedded in
// any session's jsonl head if one exists.
export async function resolveProjectCwd(project: string): Promise<string> {
  let cwd = decodeClaudeProjectName(project);
  try {
    const projDir = path.join(CLAUDE_PROJECTS, project);
    const files = await fs.readdir(projDir);
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const meta = await readSessionSummary(path.join(projDir, f));
      if (meta?.cwd) {
        cwd = meta.cwd;
        break;
      }
    }
  } catch {
    /* no sessions yet — fall back to decoded name */
  }
  return cwd;
}

export class GitError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message);
  }
}

// Run `git <args>` in cwd. Rejects with GitError carrying stderr on nonzero
// exit. `okExitCodes` lets callers accept git's "difference found" exit 1
// (used by `diff --no-index`, which exits 1 whenever it prints a diff).
async function git(
  cwd: string,
  args: string[],
  okExitCodes: number[] = [0],
): Promise<string> {
  try {
    const { stdout } = await pExecFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string; message?: string };
    if (typeof err.code === 'number' && okExitCodes.includes(err.code)) {
      return err.stdout || '';
    }
    throw new GitError((err.stderr || err.message || 'git failed').trim(), err.code ?? null);
  }
}

// Guard a caller-supplied relative path stays inside cwd. Git pathspecs are
// already repo-confined, but `diff --no-index` takes a raw filesystem path, so
// we reject anything that escapes the workspace.
function safeRelPath(cwd: string, rel: string): string {
  const abs = path.resolve(cwd, rel);
  const root = path.resolve(cwd);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new GitError(`path escapes workspace: ${rel}`, null);
  }
  return abs;
}

// Parse `git status --porcelain=v1 -z`. NUL-separated records; a rename record
// (R/C) is followed by a second NUL-terminated field carrying the old path.
function parseStatus(z: string): GitFileStatus[] {
  const parts = z.split('\0');
  const files: GitFileStatus[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const x = rec[0]!;
    const y = rec[1]!;
    const rest = rec.slice(3);
    let renamedFrom: string | undefined;
    let filePath = rest;
    if (x === 'R' || x === 'C') {
      // Rename/copy: the old path is the NEXT NUL-separated field.
      renamedFrom = parts[++i] || undefined;
    }
    const untracked = x === '?' && y === '?';
    files.push({
      path: filePath,
      x,
      y,
      staged: !untracked && x !== ' ',
      unstaged: y !== ' ' && y !== '?',
      untracked,
      renamedFrom,
    });
  }
  return files;
}

export async function status(cwd: string): Promise<GitStatus> {
  // Cheap repo probe first — a non-repo cwd should render as an empty panel,
  // not a 500.
  let repoRoot = '';
  try {
    repoRoot = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return { isRepo: false, branch: '', detached: false, hasCommits: false, ahead: 0, behind: 0, files: [] };
  }

  const hasCommits = await git(cwd, ['rev-parse', '--verify', 'HEAD'])
    .then(() => true)
    .catch(() => false);

  const branchRaw = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD')).trim();
  const detached = branchRaw === 'HEAD';
  let branch = branchRaw;
  if (detached && hasCommits) {
    branch = (await git(cwd, ['rev-parse', '--short', 'HEAD']).catch(() => 'HEAD')).trim();
  }

  let ahead = 0;
  let behind = 0;
  let upstream: string | undefined;
  if (hasCommits && !detached) {
    upstream = (await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')).trim() || undefined;
    if (upstream) {
      const counts = (await git(cwd, ['rev-list', '--count', '--left-right', `${upstream}...HEAD`]).catch(() => '')).trim();
      const m = counts.split(/\s+/);
      behind = Number(m[0]) || 0;
      ahead = Number(m[1]) || 0;
    }
  }

  const z = await git(cwd, ['status', '--porcelain=v1', '-z']);
  void repoRoot;
  return { isRepo: true, branch, detached, hasCommits, ahead, behind, upstream, files: parseStatus(z) };
}

export async function diff(
  cwd: string,
  file: string,
  opts: { staged?: boolean; untracked?: boolean } = {},
): Promise<string> {
  if (opts.untracked) {
    // Untracked files have no HEAD side — diff against /dev/null so the panel
    // shows the whole file as additions. `--no-index` exits 1 when it prints.
    const abs = safeRelPath(cwd, file);
    return git(cwd, ['diff', '--no-index', '--', '/dev/null', abs], [0, 1]);
  }
  const args = ['diff', '--no-color'];
  if (opts.staged) args.push('--cached');
  args.push('--', file);
  return git(cwd, args);
}

export async function stage(cwd: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await git(cwd, ['add', '--', ...files]);
}

export async function unstage(cwd: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  // `restore --staged` needs a commit to compare against; on a repo with no
  // HEAD yet fall back to `rm --cached` to unstage the initial add.
  const hasCommits = await git(cwd, ['rev-parse', '--verify', 'HEAD']).then(() => true).catch(() => false);
  if (hasCommits) await git(cwd, ['restore', '--staged', '--', ...files]);
  else await git(cwd, ['rm', '--cached', '-r', '--', ...files]);
}

export async function commit(cwd: string, message: string, all: boolean): Promise<string> {
  const args = ['commit'];
  if (all) args.push('-a');
  args.push('-m', message);
  return git(cwd, args);
}

export async function branches(cwd: string): Promise<GitBranches> {
  const current = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  const out = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).catch(() => '');
  const list = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return { current, branches: list };
}

export async function checkout(cwd: string, branch: string, create: boolean): Promise<string> {
  const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
  return git(cwd, args);
}
