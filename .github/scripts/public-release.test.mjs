import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LEGACY_SOURCE, NAME, PUBLIC, parseArgs, readConfiguration, release, validateMessage } from './public-release.mjs';

const identity = { GIT_AUTHOR_NAME: 'mindlab-bot', GIT_AUTHOR_EMAIL: 'contact@mindlab.ltd', GIT_COMMITTER_NAME: 'mindlab-bot', GIT_COMMITTER_EMAIL: 'contact@mindlab.ltd' };
const message = 'Add shared artifact workspaces\n\nKeep documentation and runnable examples together in the application.';
function git(cwd, args, env = {}) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: { ...process.env, ...identity, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const head = path => git(path, ['rev-parse', 'refs/heads/main']);
const refs = path => git(path, ['show-ref']);
async function file(root, path, text) { const full = join(root, path); await mkdir(join(full, '..'), { recursive: true }); await writeFile(full, text); }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'release-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), publicWork = join(root, 'public-work'), botWork = join(root, 'bot-work');
  for (const dir of [source, publicWork, botWork]) { await mkdir(dir); git(dir, ['init', '-q', '-b', 'main']); }
  const content = {
    'README.md': 'workspace\n', '.github/workflows/internal.yml': 'internal', 'nested/.github/hidden': 'hidden',
    'internal/plan.md': 'secret plan', 'internal/keep.md': 'public plan', 'private.secret': 'secret', 'visible.secret': 'keep',
    'docs/guide.md': 'guide', '.gitignore': 'ignored.txt\n', 'ignored.txt': 'tracked despite gitignore',
    '.gitattributes': 'docs/guide.md export-ignore\n', 'run.sh': '#!/bin/sh\necho example\n',
    'odd \nfile.md': 'newline filename',
  };
  for (const [path, text] of Object.entries(content)) await file(source, path, text);
  await chmod(join(source, 'run.sh'), 0o755);
  await symlink('docs/guide.md', join(source, 'guide.md'));
  git(source, ['add', '-f', '.']);
  git(source, ['commit', '-qm', 'Internal implementation (#42)'], { GIT_AUTHOR_NAME: 'Private developer', GIT_COMMITTER_NAME: 'Private developer' });
  git(source, ['tag', '-a', 'v0.9.2', '-m', 'internal release annotation']);
  for (const [path, text] of Object.entries({ 'obsolete.txt': 'delete', '.github/old.yml': 'delete', 'internal/old.md': 'delete' })) await file(publicWork, path, text);
  git(publicWork, ['add', '.']); git(publicWork, ['commit', '-qm', 'Existing public snapshot']);
  const config = { repositories: [{ name: NAME, private: LEGACY_SOURCE, public: PUBLIC, public_token_env: 'MINDLAB_BOT_GH_TOKEN', public_exclude: ['internal/*', '!internal/keep.md', '*.secret', '!visible.secret'] }] };
  const mappings = '{\n  "mappings": {\n    "other": { "keep": "untouched" },\n    "macaron-artifacts": {},\n    "last": {}\n  }\n}\n';
  await file(botWork, 'config/repositories.json', JSON.stringify(config));
  await file(botWork, 'config/commits.json', mappings);
  await file(botWork, 'unrelated.txt', 'keep this file');
  git(botWork, ['add', '.']); git(botWork, ['commit', '-qm', 'Existing bot config']);
  const publicUrl = join(root, 'public.git'), botUrl = join(root, 'bot.git');
  git(root, ['clone', '-q', '--bare', publicWork, publicUrl]); git(root, ['clone', '-q', '--bare', botWork, botUrl]);
  return { root, source, publicUrl, botUrl, config, mappings, publicBefore: head(publicUrl), botBefore: head(botUrl),
    options: { sourceUrl: source, publicUrl, botUrl, tag: 'v0.9.2', message } };
}
function allRefs(f) { return [refs(f.source), refs(f.publicUrl), refs(f.botUrl)]; }

test('CLI defaults to dry-run, requires explicit publish, and rejects conflicting flags', () => {
  assert.equal(parseArgs(['--tag', 'v0.9.2']).dryRun, true);
  assert.equal(parseArgs(['--tag', 'v0.9.2', '--publish']).dryRun, false);
  assert.throws(() => parseArgs(['--publish', '--dry-run']), /choose either/);
  assert.throws(() => parseArgs(['--tag', '--publish']), /requires a value/);
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => validateMessage('only a subject'), /blank line/);
  assert.throws(() => validateMessage('Update (#42)\n\nPrivate implementation.'), /internal/);
});

test('dry-run builds a full snapshot without writing any remote refs', async t => {
  const f = await fixture(t), before = allRefs(f);
  const result = await release(f.options);
  assert.equal(result.dryRun, true);
  assert.match(result.snapshot, /^[0-9a-f]{40}$/);
  assert.match(result.diff, /obsolete.txt/);
  assert.match(result.diff, /docs\/guide.md/);
  assert.equal(result.needsMessage, false);
  assert.deepEqual(allRefs(f), before);
  const withoutNotes = await release({ ...f.options, message: '' });
  assert.equal(withoutNotes.needsMessage, true);
  assert.equal(withoutNotes.publicCommit, null);
  await assert.rejects(release({ ...f.options, message: '', dryRun: false }), /public summary/);
  assert.deepEqual(allRefs(f), before);
});

test('publication preserves exact files, modes, symlinks, and only public commit ancestry', async t => {
  const f = await fixture(t), beforeSource = refs(f.source);
  const preview = await release(f.options);
  const published = await release({ ...f.options, dryRun: false });
  assert.equal(published.publicCommit, preview.publicCommit);
  assert.equal(head(f.publicUrl), published.publicCommit);
  assert.equal(git(f.publicUrl, ['rev-parse', 'refs/tags/v0.9.2']), published.publicCommit);
  assert.equal(git(f.publicUrl, ['show', '-s', '--format=%P', 'main']), f.publicBefore);
  assert.equal(git(f.publicUrl, ['rev-list', '--count', 'main']), '2');
  assert.equal(git(f.publicUrl, ['show', '-s', '--format=%an <%ae>%n%cn <%ce>', 'main']), 'mindlab-bot <contact@mindlab.ltd>\nmindlab-bot <contact@mindlab.ltd>');
  assert.equal(git(f.publicUrl, ['show', '-s', '--format=%B', 'main']), message);
  const files = git(f.publicUrl, ['ls-tree', '-rz', 'main']).split('\0').filter(Boolean).map(s => s.slice(s.indexOf('\t') + 1));
  for (const path of ['README.md', 'docs/guide.md', 'internal/keep.md', 'ignored.txt', 'visible.secret', 'odd \nfile.md']) assert.ok(files.includes(path), path);
  for (const path of ['.github/old.yml', '.github/workflows/internal.yml', 'nested/.github/hidden', 'obsolete.txt', 'private.secret', 'internal/plan.md']) assert.ok(!files.includes(path), path);
  assert.match(git(f.publicUrl, ['ls-tree', 'main', 'run.sh']), /^100755 /);
  assert.match(git(f.publicUrl, ['ls-tree', 'main', 'guide.md']), /^120000 /);
  assert.equal(git(f.publicUrl, ['show', 'main:guide.md']), 'docs/guide.md');
  const mapping = git(f.botUrl, ['show', 'main:config/commits.json']);
  assert.equal(JSON.parse(mapping).mappings[NAME][published.sourceCommit], published.publicCommit);
  assert.match(mapping, /"other": \{ "keep": "untouched" \}/);
  assert.equal(git(f.botUrl, ['diff', '--name-only', f.botBefore, 'main']), 'config/commits.json');
  assert.equal(refs(f.source), beforeSource);
});

test('retries are idempotent and older tags never rewind a newer public main', async t => {
  const f = await fixture(t);
  const first = await release({ ...f.options, dryRun: false });
  const afterFirst = allRefs(f);
  await release({ ...f.options, dryRun: false });
  assert.deepEqual(allRefs(f), afterFirst);
  await file(f.source, 'README.md', 'updated workspace');
  git(f.source, ['add', '.']); git(f.source, ['commit', '-qm', 'Next version']); git(f.source, ['tag', 'v0.9.3']);
  await release({ ...f.options, tag: 'v0.9.3', dryRun: false });
  const afterSecond = allRefs(f);
  const retried = await release({ ...f.options, dryRun: false });
  assert.equal(retried.publicCommit, first.publicCommit);
  assert.deepEqual(allRefs(f), afterSecond);
});

test('existing tag conflicts require force and force dry-run still writes nothing', async t => {
  const f = await fixture(t);
  await release({ ...f.options, dryRun: false });
  await file(f.source, 'README.md', 'replacement contents');
  git(f.source, ['add', '.']); git(f.source, ['commit', '-qm', 'Replacement']); git(f.source, ['tag', '-f', 'v0.9.2']);
  const before = allRefs(f);
  await assert.rejects(release({ ...f.options, dryRun: false }), /requires --force/);
  await release({ ...f.options, force: true });
  assert.deepEqual(allRefs(f), before);
  const forced = await release({ ...f.options, force: true, dryRun: false });
  assert.equal(head(f.publicUrl), forced.publicCommit);
  assert.equal(git(f.publicUrl, ['show', 'main:README.md']), 'replacement contents');
});

test('a rejected tag cannot leave main partially published', async t => {
  const f = await fixture(t), before = allRefs(f);
  // Receive hooks are server-side; the client cannot disable them with core.hooksPath.
  await file(f.publicUrl, 'hooks/update', '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1;; esac\n');
  await chmod(join(f.publicUrl, 'hooks/update'), 0o755);
  await assert.rejects(release({ ...f.options, dryRun: false }), /git push failed/);
  assert.deepEqual(allRefs(f), before);
});

test('mapping push failure is recoverable after the public refs are published', async t => {
  const f = await fixture(t);
  await file(f.botUrl, 'hooks/pre-receive', '#!/bin/sh\nexit 1\n');
  await chmod(join(f.botUrl, 'hooks/pre-receive'), 0o755);
  await assert.rejects(release({ ...f.options, dryRun: false }), /mapping write failed.*Rerun/s);
  const publicRefs = refs(f.publicUrl);
  assert.equal(head(f.botUrl), f.botBefore);
  await rm(join(f.botUrl, 'hooks/pre-receive'));
  const retry = await release({ ...f.options, dryRun: false });
  assert.equal(refs(f.publicUrl), publicRefs);
  const mappings = JSON.parse(git(f.botUrl, ['show', 'main:config/commits.json'])).mappings;
  assert.equal(mappings[NAME][retry.sourceCommit], retry.publicCommit);
});

test('invalid policies, tags, and missing mappings fail without changing remotes', async t => {
  const f = await fixture(t), before = allRefs(f);
  for (const tag of ['main', 'v1;touch injected', 'v1\nnext', 'v1$(id)', 'v99.0.0']) await assert.rejects(release({ ...f.options, tag }));
  assert.throws(() => readConfiguration(JSON.stringify({ repositories: [f.config.repositories[0], f.config.repositories[0]] })), /exactly one/);
  for (const public_exclude of ['internal', ['internal\nREADME.md']]) assert.throws(() => readConfiguration(JSON.stringify({ repositories: [{ ...f.config.repositories[0], public_exclude }] })), /single-line/);
  assert.deepEqual(allRefs(f), before);
});

test('mapping retries preserve a concurrent update from another project', async t => {
  const f = await fixture(t), other = join(f.root, 'other-writer');
  git(f.root, ['clone', '-q', f.botUrl, other]);
  const nextMappings = f.mappings.replace('"keep": "untouched"', '"keep": "concurrently updated"');
  await file(other, 'config/commits.json', nextMappings);
  git(other, ['add', '.']); git(other, ['commit', '-qm', 'Other project mapping']);
  const next = head(other);
  git(f.botUrl, ['fetch', '-q', other, 'main:refs/heads/other-writer']);
  // Advance the real remote after the client has read it, so its first compare-and-swap fails.
  await file(f.botUrl, 'hooks/pre-receive', `#!/bin/sh
unset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
if [ ! -f hooks/raced ]; then
  touch hooks/raced
  git update-ref refs/heads/main ${next} ${f.botBefore} || exit 1
  exit 1
fi
`);
  await chmod(join(f.botUrl, 'hooks/pre-receive'), 0o755);
  const result = await release({ ...f.options, dryRun: false });
  const mapping = JSON.parse(git(f.botUrl, ['show', 'main:config/commits.json'])).mappings;
  assert.equal(mapping.other.keep, 'concurrently updated');
  assert.equal(mapping[NAME][result.sourceCommit], result.publicCommit);
  assert.equal(git(f.botUrl, ['show', '-s', '--format=%P', 'main']), next);
});

test('missing mapping sections and empty exports are rejected before publishing', async t => {
  const f = await fixture(t), botWork = join(f.root, 'bot-work');
  await file(botWork, 'config/commits.json', '{"mappings":{}}');
  git(botWork, ['add', '.']); git(botWork, ['commit', '-qm', 'Missing project mapping']);
  git(botWork, ['push', '-q', f.botUrl, 'main']);
  const before = allRefs(f);
  await assert.rejects(release({ ...f.options, dryRun: false }), /missing mappings/);
  assert.deepEqual(allRefs(f), before);
  await file(botWork, 'config/commits.json', f.mappings);
  f.config.repositories[0].public_exclude = ['*'];
  await file(botWork, 'config/repositories.json', JSON.stringify(f.config));
  git(botWork, ['add', '.']); git(botWork, ['commit', '-qm', 'Empty export policy']); git(botWork, ['push', '-q', f.botUrl, 'main']);
  const emptyBefore = allRefs(f);
  await assert.rejects(release({ ...f.options, dryRun: false }), /empty public snapshot/);
  assert.deepEqual(allRefs(f), emptyBefore);
});
