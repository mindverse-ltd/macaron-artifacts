#!/usr/bin/env node
// Deterministic implementation of MindLab's release skill. No source checkout code is executed.
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAME = 'macaron-artifacts';
export const SOURCE = 'mindverse-ltd/macaron-artifacts';
export const LEGACY_SOURCE = 'mindverse-ltd/macaron-claude-code';
export const PUBLIC = 'MindLab-Research/macaron-artifacts';
export const BOT = 'MindLab-Research/mindlab-bot';
const IDENTITY = { GIT_AUTHOR_NAME: 'mindlab-bot', GIT_AUTHOR_EMAIL: 'contact@mindlab.ltd', GIT_COMMITTER_NAME: 'mindlab-bot', GIT_COMMITTER_EMAIL: 'contact@mindlab.ltd' };

function git(args, { cwd, env = {}, input, allow = [0] } = {}) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000,
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

export function readConfiguration(text) {
  const matches = JSON.parse(text).repositories?.filter(entry => entry.name === NAME);
  if (matches?.length !== 1) throw new Error(`expected exactly one ${NAME} repository mapping`);
  const config = matches[0];
  if (![SOURCE, LEGACY_SOURCE].includes(config.private) || config.public !== PUBLIC || config.public_token_env !== 'MINDLAB_BOT_GH_TOKEN' || Object.hasOwn(config, 'public_ssh_key_env')) throw new Error('unexpected source, public repository, or credential policy');
  if (config.public_exclude !== undefined && (!Array.isArray(config.public_exclude) || config.public_exclude.some(pattern => typeof pattern !== 'string' || /[\r\n\0]/.test(pattern)))) throw new Error('public_exclude must contain single-line gitignore patterns');
  return config;
}

function readMappings(text) {
  const data = JSON.parse(text), entries = data.mappings?.[NAME];
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`missing mappings.${NAME}`);
  if (Object.entries(entries).some(([source, target]) => !/^[a-f0-9]{40}$/.test(source) || typeof target !== 'string' || !/^[a-f0-9]{40}$/.test(target))) throw new Error('invalid release commit mapping');
  return data;
}

export function updateMappingText(text, source, target, force = false) {
  const data = readMappings(text), entries = data.mappings[NAME];
  if (entries[source] === target) return text;
  if (entries[source] && !force) throw new Error(`source ${source} already maps to ${entries[source]}`);
  // Preserve formatting outside this project's object so concurrent projects keep minimal diffs.
  const match = /"macaron-artifacts"\s*:\s*\{[^{}]*\}/.exec(text);
  if (!match) throw new Error('cannot locate the release mapping object');
  const indent = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index).match(/^\s*/)[0];
  entries[source] = target;
  const replacement = `"${NAME}": ${JSON.stringify(entries, null, 2).replaceAll('\n', `\n${indent}`)}`;
  const updated = text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
  if (JSON.stringify(JSON.parse(updated)) !== JSON.stringify(data)) throw new Error('mapping update would change unrelated data');
  return updated;
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

async function snapshotTree(cwd, sourceCommit, patterns, scratch) {
  git(['read-tree', sourceCommit], { cwd });
  const entries = git(['ls-tree', '-rz', sourceCommit], { cwd }).split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t');
    return { path: entry.slice(tab + 1), mode: entry.slice(0, 6) };
  });
  const excluded = new Set(entries.filter(entry => entry.path.split('/').some(part => part === '.github' || part === '.git')).map(entry => entry.path));
  if (patterns.length) {
    const file = join(scratch, 'excludes');
    await writeFile(file, patterns.join('\n') + '\n');
    // The worktree is empty: source .gitignore files must not alter public_exclude or drop tracked files.
    const ignored = git(['-c', `core.excludesFile=${file}`, 'check-ignore', '--no-index', '-z', '--stdin'], {
      cwd, input: entries.map(entry => entry.path).join('\0') + '\0', allow: [0, 1],
    });
    for (const path of ignored.split('\0').filter(Boolean)) excluded.add(path);
  }
  if (entries.some(entry => entry.mode === '160000' && !excluded.has(entry.path))) throw new Error('source contains a submodule; exclude it or vendor its contents before publishing');
  if (!entries.some(entry => !excluded.has(entry.path))) throw new Error('refusing an empty public snapshot');
  if (excluded.size) git(['update-index', '--force-remove', '-z', '--stdin'], { cwd, input: [...excluded].join('\0') + '\0' });
  return git(['write-tree'], { cwd }).trim();
}

async function saveMapping(cwd, source, target, tag, force, expectedConfig, env) {
  for (let attempt = 0; attempt < 3; attempt++) {
    git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { cwd, env });
    const base = oid(cwd, 'refs/remotes/origin/main');
    const config = readConfiguration(git(['show', `${base}:config/repositories.json`], { cwd }));
    if (JSON.stringify(config) !== JSON.stringify(expectedConfig)) throw new Error('release policy changed; rerun dry-run before updating the mapping');
    const before = git(['show', `${base}:config/commits.json`], { cwd });
    const after = updateMappingText(before, source, target, force);
    if (after === before) return;
    git(['read-tree', base], { cwd });
    const blob = git(['hash-object', '-w', '--stdin'], { cwd, input: after }).trim();
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},config/commits.json`], { cwd });
    const commit = createCommit(cwd, git(['write-tree'], { cwd }).trim(), base, `Record ${NAME} ${tag} mapping`);
    try {
      git(['push', `--force-with-lease=refs/heads/main:${base}`, 'origin', `${commit}:refs/heads/main`], { cwd, env });
      return;
    } catch (error) { if (attempt === 2) throw error; }
  }
}

// URLs and git environments are injected for integration tests against disposable local bare repos.
export async function release({ tag, dryRun = true, force = false, message = '', sourceUrl, publicUrl, botUrl, sourceEnv = {}, publicEnv = {}, botEnv = {} }) {
  if (!/^v[0-9][0-9A-Za-z.+-]*$/.test(tag)) throw new Error('tag must be an existing version such as v1.0.0');
  if (typeof dryRun !== 'boolean' || typeof force !== 'boolean') throw new Error('dryRun and force must be booleans');
  if (!dryRun || message) message = validateMessage(message);
  const scratch = await mkdtemp(join(tmpdir(), 'macaron-public-release-'));
  try {
    const source = join(scratch, 'source'), target = join(scratch, 'public'), bot = join(scratch, 'bot');
    const tagRef = `refs/tags/${tag}`;
    // Only the tagged tree is needed; fetching the entire internal history slows down every dry-run.
    git(['init', '--quiet', source]);
    git(['fetch', '--quiet', '--depth=1', '--no-tags', sourceUrl, `${tagRef}:${tagRef}`], { cwd: source, env: sourceEnv });
    for (const [url, destination, env] of [[publicUrl, target, publicEnv], [botUrl, bot, botEnv]]) git(['clone', '--quiet', '--no-checkout', '--', url, destination], { env });
    const sourceCommit = oid(source, `${tagRef}^{commit}`);
    const publicBase = oid(target, 'refs/remotes/origin/main'), oldTag = oid(target, tagRef, false), oldTagCommit = oldTag && oid(target, `${tagRef}^{commit}`);
    const botBase = oid(bot, 'refs/remotes/origin/main');
    const config = readConfiguration(git(['show', `${botBase}:config/repositories.json`], { cwd: bot }));
    const mappings = readMappings(git(['show', `${botBase}:config/commits.json`], { cwd: bot })).mappings[NAME];
    // Import objects only. The public commit has ONLY a public parent, never a source-history parent.
    git(['fetch', '--quiet', '--no-tags', source, sourceCommit], { cwd: target });
    const snapshot = await snapshotTree(target, sourceCommit, config.public_exclude || [], scratch);
    let publicCommit, publicMain = publicBase;
    if (oldTagCommit && tree(target, oldTagCommit) === snapshot && botAuthored(target, oldTagCommit) && isAncestor(target, oldTagCommit, publicBase)) {
      publicCommit = oldTagCommit; // A retry of an older tag must not rewind a newer public main.
    } else if (oldTag && !force) {
      throw new Error(`public tag ${tag} conflicts with this snapshot; replacement requires --force`);
    } else if (!oldTag && mappings[sourceCommit] && oid(target, `${mappings[sourceCommit]}^{commit}`, false) && tree(target, mappings[sourceCommit]) === snapshot && botAuthored(target, mappings[sourceCommit]) && isAncestor(target, mappings[sourceCommit], publicBase)) {
      publicCommit = mappings[sourceCommit];
    } else if (tree(target, publicBase) === snapshot && botAuthored(target, publicBase)) {
      publicCommit = publicBase;
    } else if (message) {
      const date = git(['show', '-s', '--format=%cI', sourceCommit], { cwd: source }).trim();
      publicCommit = createCommit(target, snapshot, publicBase, message, date);
      publicMain = publicCommit;
    }
    if (publicCommit) updateMappingText(git(['show', `${botBase}:config/commits.json`], { cwd: bot }), sourceCommit, publicCommit, force);
    const diff = git(['diff', '--stat', publicBase, snapshot, '--'], { cwd: target });
    const result = { tag, dryRun, sourceCommit, snapshot, publicCommit: publicCommit || null, publicMain, diff, needsMessage: !publicCommit };
    if (dryRun) return result;

    const refspecs = [], leases = [];
    if (publicMain !== publicBase) { refspecs.push(`${publicMain}:refs/heads/main`); leases.push(`--force-with-lease=refs/heads/main:${publicBase}`); }
    if (oldTagCommit !== publicCommit) { refspecs.push(`${publicCommit}:${tagRef}`); leases.push(`--force-with-lease=${tagRef}:${oldTag || ''}`); }
    // Both refs advance together; exact leases reject any change since the initial read, including forced tags.
    if (refspecs.length) git(['push', '--atomic', ...leases, 'origin', ...refspecs], { cwd: target, env: publicEnv });
    try { await saveMapping(bot, sourceCommit, publicCommit, tag, force, config, botEnv); }
    catch (error) { throw new Error(`public ${tag} is published at ${publicCommit}, but mapping write failed: ${error.message}. Rerun the same release to repair it.`); }
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
  const checks = await Promise.all([api('user', token), api(`repos/${PUBLIC}`, token), api(`repos/${BOT}`, token), api(`repos/${LEGACY_SOURCE}`, sourceToken)]);
  if (checks[0].login !== 'mindlab-bot') throw new Error('MINDLAB_BOT_GH_TOKEN must belong to mindlab-bot');
  if (!checks[1].permissions?.push || !checks[2].permissions?.push) throw new Error('bot token needs Contents read/write on both the public repository and mindlab-bot');
  if (checks[3].full_name !== SOURCE) throw new Error('legacy source URL no longer resolves to the expected repository');
  const summary = process.env.PUBLIC_RELEASE_SUMMARY || '', details = process.env.PUBLIC_RELEASE_DETAILS || '';
  const message = options.messageFile ? await readFile(options.messageFile, 'utf8') : (summary || details ? `${summary}\n\n${details}` : '');
  const result = await release({ ...options, message, sourceUrl: `https://github.com/${SOURCE}.git`, publicUrl: `https://github.com/${PUBLIC}.git`, botUrl: `https://github.com/${BOT}.git`, sourceEnv: authEnv(sourceToken), publicEnv: authEnv(token), botEnv: authEnv(token) });
  const report = [
    `### ${result.dryRun ? 'Dry run' : 'Published'} ${result.tag}`, '', `Source commit: ${result.sourceCommit}`, `Public snapshot tree: ${result.snapshot}`,
    `Public commit: ${result.publicCommit || 'pending public release description'}`, '', result.diff || 'No public file changes.', '',
    ...(result.needsMessage ? ['Provide a public summary and description before publishing.'] : []),
    result.dryRun ? 'No remote commits, tags, or mappings were written. API-reported permissions do not prove branch-rule acceptance.' : 'Public refs and commit mapping are synchronized.',
  ].join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`public-release: ${error.message}`); process.exitCode = 1; });
