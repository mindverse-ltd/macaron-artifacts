#!/usr/bin/env node
// Publish a filtered tag snapshot directly to the public repository; no source code is executed.
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'mindverse-ltd/macaron-artifacts';
export const PUBLIC = 'MindLab-Research/macaron-artifacts';
const IDENTITY = { GIT_AUTHOR_NAME: 'mindlab-bot', GIT_AUTHOR_EMAIL: 'contact@mindlab.ltd', GIT_COMMITTER_NAME: 'mindlab-bot', GIT_COMMITTER_EMAIL: 'contact@mindlab.ltd' };

function git(args, { cwd, env = {}, input, allow = [0], encoding = 'utf8' } = {}) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, input, encoding, maxBuffer: 64 * 1024 * 1024, timeout: 120_000,
    env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw result.error;
  if (!allow.includes(result.status)) throw new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

export function parseArgs(argv) {
  const options = { dryRun: true, force: false, tag: '' };
  let mode;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tag' || arg === '--message-file') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg === '--tag' ? 'tag' : 'messageFile'] = value;
    } else if (arg === '--publish' || arg === '--dry-run') {
      if (mode && mode !== arg) throw new Error('choose either --publish or --dry-run');
      mode = arg; options.dryRun = arg !== '--publish';
    } else if (arg === '--force') options.force = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export function validateMessage(message) {
  const lines = message.replaceAll('\r\n', '\n').trim().split('\n');
  if (!lines[0] || [...lines[0]].length >= 72 || lines[1] !== '' || !lines[2]?.trim()) throw new Error('provide a public summary under 72 characters, a blank line, and a nonempty description');
  if (/mindverse-ltd|macaron-claude-code|Co-authored-by:|Signed-off-by:|(?:^|\s|\()#\d+|github\.com\/[^\s]+\/(?:pull|issues)\//im.test(message)) throw new Error('public description must not include internal repository names, author trailers, or PR/issue references');
  return lines.join('\n');
}

function oid(cwd, ref, required = true) {
  const value = git(['rev-parse', '--verify', '--quiet', ref], { cwd, allow: required ? [0] : [0, 1] }).trim();
  return value || null;
}
function tree(cwd, ref) { return oid(cwd, `${ref}^{tree}`); }
function isAncestor(cwd, ancestor, descendant) {
  // merge-base has no stdout; rev-list gives the count of commits not reachable from the descendant.
  return git(['rev-list', '--count', ancestor, `^${descendant}`], { cwd }).trim() === '0';
}
function botAuthored(cwd, ref) {
  return git(['show', '-s', '--format=%an <%ae>%n%cn <%ce>', ref], { cwd }).trim() === 'mindlab-bot <contact@mindlab.ltd>\nmindlab-bot <contact@mindlab.ltd>';
}
function createCommit(cwd, snapshot, parent, message, date) {
  return git(['commit-tree', snapshot, '-p', parent], { cwd, input: message + '\n', env: { ...IDENTITY, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } }).trim();
}

function snapshotTree(cwd, sourceCommit) {
  git(['read-tree', sourceCommit], { cwd });
  // Git paths are bytes, not necessarily UTF-8. Latin-1 gives a lossless byte/string round trip.
  const entries = git(['ls-tree', '-rz', sourceCommit], { cwd, encoding: 'latin1' }).split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t');
    return { path: entry.slice(tab + 1), mode: entry.slice(0, 6) };
  });
  const excluded = new Set(entries.filter(entry => entry.path.split('/').some(part => part === '.github' || part === '.git')).map(entry => entry.path));

  if (entries.some(entry => entry.mode === '160000' && !excluded.has(entry.path))) throw new Error('source contains a submodule; vendor its contents before publishing');
  if (!entries.some(entry => !excluded.has(entry.path))) throw new Error('refusing an empty public snapshot');
  if (excluded.size) git(['update-index', '--force-remove', '-z', '--stdin'], { cwd, input: Buffer.from([...excluded].join('\0') + '\0', 'latin1') });
  return git(['write-tree'], { cwd }).trim();
}

// URLs and git environments are injected for integration tests against disposable local bare repos.
export async function release({ tag, dryRun = true, force = false, message = '', sourceUrl, publicUrl, sourceEnv = {}, publicEnv = {} }) {
  if (!/^v[0-9][0-9A-Za-z.+-]*$/.test(tag)) throw new Error('tag must be an existing version such as v1.0.0');
  if (typeof dryRun !== 'boolean' || typeof force !== 'boolean') throw new Error('dryRun and force must be booleans');
  if (!dryRun || message) message = validateMessage(message);
  const scratch = await mkdtemp(join(tmpdir(), 'macaron-public-release-'));
  try {
    const source = join(scratch, 'source'), target = join(scratch, 'public');
    const tagRef = `refs/tags/${tag}`;
    // Only the tagged tree is needed; fetching the entire internal history slows down every dry-run.
    git(['init', '--quiet', source]);
    git(['fetch', '--quiet', '--depth=1', '--no-tags', sourceUrl, `${tagRef}:${tagRef}`], { cwd: source, env: sourceEnv });
    git(['clone', '--quiet', '--no-checkout', '--', publicUrl, target], { env: publicEnv });
    const sourceCommit = oid(source, `${tagRef}^{commit}`);
    const publicBase = oid(target, 'refs/remotes/origin/main'), oldTag = oid(target, tagRef, false), oldTagCommit = oldTag && oid(target, `${tagRef}^{commit}`, false);

    // Import objects only. The public commit has ONLY a public parent, never a source-history parent.
    git(['fetch', '--quiet', '--no-tags', source, sourceCommit], { cwd: target });
    const snapshot = snapshotTree(target, sourceCommit);
    let publicCommit, publicMain = publicBase;
    if (oldTagCommit && tree(target, oldTagCommit) === snapshot && botAuthored(target, oldTagCommit) && isAncestor(target, oldTagCommit, publicBase)) {
      publicCommit = oldTagCommit; // A retry of an older tag must not rewind a newer public main.
    } else if (oldTag && !force) {
      throw new Error(`public tag ${tag} conflicts with this snapshot; replacement requires --force`);
    } else if (tree(target, publicBase) === snapshot && botAuthored(target, publicBase)) {
      publicCommit = publicBase;
    } else if (message) {
      const date = git(['show', '-s', '--format=%cI', sourceCommit], { cwd: source }).trim();
      publicCommit = createCommit(target, snapshot, publicBase, message, date);
      publicMain = publicCommit;
    }

    const diff = git(['diff', '--stat', publicBase, snapshot, '--'], { cwd: target });
    const result = { tag, dryRun, sourceCommit, snapshot, publicCommit: publicCommit || null, publicMain, diff, needsMessage: !publicCommit };
    if (dryRun) return result;

    const refspecs = [], leases = [];
    if (publicMain !== publicBase) { refspecs.push(`${publicMain}:refs/heads/main`); leases.push(`--force-with-lease=refs/heads/main:${publicBase}`); }
    if (oldTagCommit !== publicCommit) { refspecs.push(`${publicCommit}:${tagRef}`); leases.push(`--force-with-lease=${tagRef}:${oldTag || ''}`); }
    // Both refs advance together; exact leases reject any change since the initial read, including forced tags.
    if (refspecs.length) git(['push', '--atomic', ...leases, 'origin', ...refspecs], { cwd: target, env: publicEnv });

    return result;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

function authEnv(token) {
  // Credentials stay out of argv, remote URLs, and persistent git config.
  return token ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` } : {};
}
async function api(path, token) {
  const response = await fetch(`https://api.github.com/${path}`, { headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub GET ${path} returned ${response.status}`);
  return response.json();
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log('Usage: node .github/scripts/public-release.mjs --tag vX.Y.Z [--dry-run | --publish] [--message-file notes.md] [--force]'); return; }
  const token = process.env.MINDLAB_BOT_GH_TOKEN?.trim(), sourceToken = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error('MINDLAB_BOT_GH_TOKEN is required in repository Actions secrets');
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== SOURCE) throw new Error(`run this workflow in ${SOURCE}`);
  const checks = await Promise.all([api('user', token), api(`repos/${PUBLIC}`, token)]);
  if (checks[0].login !== 'mindlab-bot') throw new Error('MINDLAB_BOT_GH_TOKEN must belong to mindlab-bot');
  if (!checks[1].permissions?.push) throw new Error('MINDLAB_BOT_GH_TOKEN needs Contents read/write on the public repository');
  const summary = process.env.PUBLIC_RELEASE_SUMMARY || '', details = process.env.PUBLIC_RELEASE_DETAILS || '';
  const message = options.messageFile ? await readFile(options.messageFile, 'utf8') : (summary || details ? `${summary}\n\n${details}` : '');
  const result = await release({ ...options, message, sourceUrl: `https://github.com/${SOURCE}.git`, publicUrl: `https://github.com/${PUBLIC}.git`, sourceEnv: authEnv(sourceToken), publicEnv: authEnv(token) });
  const report = [
    `### ${result.dryRun ? 'Dry run' : 'Published'} ${result.tag}`, '', `Source commit: ${result.sourceCommit}`, `Public snapshot tree: ${result.snapshot}`,
    `Public commit: ${result.publicCommit || 'pending public release description'}`, '', result.diff || 'No public file changes.', '',
    ...(result.needsMessage ? ['Provide a public summary and description before publishing.'] : []),
    result.dryRun ? 'No remote commits or tags were written. API-reported permissions do not prove branch-rule acceptance.' : 'Public main and tag are published.',
  ].join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`public-release: ${error.message}`); process.exitCode = 1; });
