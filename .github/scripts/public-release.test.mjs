import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SOURCE, PUBLIC, parseArgs, release, validateMessage } from './public-release.mjs';

const identity = { GIT_AUTHOR_NAME: 'mindlab-bot', GIT_AUTHOR_EMAIL: 'contact@mindlab.ltd', GIT_COMMITTER_NAME: 'mindlab-bot', GIT_COMMITTER_EMAIL: 'contact@mindlab.ltd' };
const message = 'Add shared artifact workspaces\n\nKeep documentation and runnable examples together in the application.';
function git(cwd, args, env = {}) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: { ...process.env, ...identity, ...env }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const head = path => git(path, ['rev-parse', 'refs/heads/main']);
const refs = path => git(path, ['show-ref']);
async function file(root, path, text) { const full = join(root, path); await mkdir(join(full, '..'), { recursive: true }); await writeFile(full, text); }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'release-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), publicWork = join(root, 'public-work');
  for (const dir of [source, publicWork]) { await mkdir(dir); git(dir, ['init', '-q', '-b', 'main']); }
  const content = {
    'README.md': 'workspace\n', '.github/workflows/internal.yml': 'internal', 'nested/.github/hidden': 'hidden',
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
  const publicUrl = join(root, 'public.git');
  git(root, ['clone', '-q', '--bare', publicWork, publicUrl]);
  return { root, source, publicUrl, publicBefore: head(publicUrl), options: { sourceUrl: source, publicUrl, tag: 'v0.9.2', message } };
}
function allRefs(f) { return [refs(f.source), refs(f.publicUrl)]; }

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
  for (const path of ['README.md', 'docs/guide.md', 'ignored.txt', 'odd \nfile.md']) assert.ok(files.includes(path), path);
  for (const path of ['.github/old.yml', '.github/workflows/internal.yml', 'nested/.github/hidden', 'obsolete.txt', 'internal/old.md']) assert.ok(!files.includes(path), path);
  assert.match(git(f.publicUrl, ['ls-tree', 'main', 'run.sh']), /^100755 /);
  assert.match(git(f.publicUrl, ['ls-tree', 'main', 'guide.md']), /^120000 /);
  assert.equal(git(f.publicUrl, ['show', 'main:guide.md']), 'docs/guide.md');
  assert.equal(refs(f.source), beforeSource);
});

test('non-UTF-8 filenames cannot bypass exclusions and retained paths preserve their bytes', async t => {
  const f = await fixture(t);
  const rawName = Buffer.concat([Buffer.from('byte-'), Buffer.from([0xff]), Buffer.from('.txt')]);
  for (const dir of ['.github', 'nested/.github', 'docs']) {
    await writeFile(Buffer.concat([Buffer.from(join(f.source, dir) + '/'), rawName]), 'byte-path content');
  }
  git(f.source, ['add', '-f', '.']); git(f.source, ['commit', '-qm', 'Byte filenames']); git(f.source, ['tag', 'v0.9.3']);
  const before = allRefs(f);
  const options = { ...f.options, tag: 'v0.9.3' };
  const preview = await release(options);
  assert.deepEqual(allRefs(f), before);
  const result = await release({ ...options, dryRun: false });
  assert.equal(result.publicCommit, preview.publicCommit);
  const listed = spawnSync('git', ['ls-tree', '-rz', result.publicCommit], { cwd: f.publicUrl, timeout: 30_000 });
  assert.equal(listed.status, 0, listed.stderr.toString());
  const paths = listed.stdout.toString('latin1').split('\0').filter(Boolean).map(entry => entry.slice(entry.indexOf('\t') + 1));
  assert.ok(paths.every(path => !path.split('/').includes('.github')));
  assert.ok(paths.includes('docs/' + rawName.toString('latin1')));
});

test('force replaces non-commit public tags while unforced and dry runs leave refs unchanged', async t => {
  const f = await fixture(t);
  for (const ref of ['main:obsolete.txt', 'main^{tree}']) {
    const object = git(f.publicUrl, ['rev-parse', ref]);
    git(f.publicUrl, ['update-ref', 'refs/tags/v0.9.2', object]);
    const before = allRefs(f);
    await assert.rejects(release({ ...f.options, dryRun: false }), /requires --force/);
    await release({ ...f.options, force: true });
    assert.deepEqual(allRefs(f), before);
    const result = await release({ ...f.options, dryRun: false, force: true });
    assert.equal(git(f.publicUrl, ['rev-parse', 'refs/tags/v0.9.2']), result.publicCommit);
    assert.equal(git(f.publicUrl, ['cat-file', '-t', 'refs/tags/v0.9.2']), 'commit');
    assert.equal(head(f.publicUrl), result.publicCommit);
  }
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
  await rm(join(f.publicUrl, 'hooks/update'));
  const retry = await release({ ...f.options, dryRun: false });
  assert.equal(head(f.publicUrl), retry.publicCommit);
  assert.equal(git(f.publicUrl, ['rev-parse', 'refs/tags/v0.9.2']), retry.publicCommit);
});

test('invalid and missing source tags fail without changing remotes', async t => {
  const f = await fixture(t), before = allRefs(f);
  for (const tag of ['main', 'v1;touch injected', 'v1\nnext', 'v1$(id)', 'v99.0.0']) await assert.rejects(release({ ...f.options, tag }));
  assert.deepEqual(allRefs(f), before);
});

test('empty snapshots and submodules are rejected before publishing', async t => {
  const f = await fixture(t);
  git(f.source, ['update-index', '--add', '--cacheinfo', `160000,${head(f.source)},dependency`]);
  git(f.source, ['commit', '-qm', 'Submodule']); git(f.source, ['tag', 'v0.9.3']);
  const beforeSubmodule = allRefs(f);
  await assert.rejects(release({ ...f.options, tag: 'v0.9.3', dryRun: false }), /submodule/);
  assert.deepEqual(allRefs(f), beforeSubmodule);
  git(f.source, ['read-tree', '--empty']);
  git(f.source, ['add', '.github']); git(f.source, ['commit', '-qm', 'Only excluded files']); git(f.source, ['tag', 'v0.9.4']);
  const beforeEmpty = allRefs(f);
  await assert.rejects(release({ ...f.options, tag: 'v0.9.4', dryRun: false }), /empty public snapshot/);
  assert.deepEqual(allRefs(f), beforeEmpty);
});

test('a new tag for the current snapshot reuses the public commit', async t => {
  const f = await fixture(t);
  const first = await release({ ...f.options, dryRun: false });
  git(f.source, ['tag', 'v0.9.3']);
  const second = await release({ ...f.options, tag: 'v0.9.3', dryRun: false });
  assert.equal(second.publicCommit, first.publicCommit);
  assert.equal(head(f.publicUrl), first.publicCommit);
  assert.equal(git(f.publicUrl, ['rev-parse', 'refs/tags/v0.9.3']), first.publicCommit);
});

test('CLI needs only source and public repositories and performs one atomic push', async t => {
  const f = await fixture(t), log = join(f.root, 'transport.jsonl');
  const config = { log, source: SOURCE, public: PUBLIC, urls: { [`https://github.com/${SOURCE}.git`]: f.source, [`https://github.com/${PUBLIC}.git`]: f.publicUrl } };
  const preload = `
    import assert from 'node:assert/strict';
    import cp from 'node:child_process';
    import { appendFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const c = ${JSON.stringify(config)};
    const record = entry => appendFileSync(c.log, JSON.stringify(entry) + '\\n');
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      assert.ok(path === '/user' || path === '/repos/' + c.public, 'unexpected external repository access');
      assert.ok(options.headers.Authorization === ['Bearer', 'fixture-public'].join(' '), 'wrong API identity');
      record({kind:'api', path});
      return new Response(JSON.stringify(path === '/user' ? {login:'mindlab-bot'} : {permissions:{push:true}}));
    };
    const spawn = cp.spawnSync;
    cp.spawnSync = (command, args, options = {}) => {
      assert.equal(command, 'git');
      const remote = args.find(arg => arg.startsWith('https://'));
      if (remote) assert.ok(Object.hasOwn(c.urls, remote), 'unexpected external Git repository');
      const push = args.includes('push');
      if (remote || push) {
        const role = remote?.includes(c.source + '.git') ? 'source' : 'public';
        assert.ok(options.env.GIT_CONFIG_VALUE_0 === 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:fixture-' + role).toString('base64'), 'wrong Git identity');
        record({kind:'git', role, push, atomic:args.includes('--atomic')});
      }
      return spawn(command, args.map(arg => c.urls[arg] || arg), options);
    };
    syncBuiltinESMExports();
  `;
  const run = async publish => {
    await writeFile(log, '');
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), fileURLToPath(new URL('./public-release.mjs', import.meta.url)), '--tag', 'v0.9.2', ...(publish ? ['--publish'] : [])], {
      env: { ...process.env, GITHUB_REPOSITORY: SOURCE, GITHUB_TOKEN: 'fixture-source', MINDLAB_BOT_GH_TOKEN: 'fixture-public', MINDLAB_MAPPING_GH_TOKEN: '', PUBLIC_RELEASE_SUMMARY: message.split('\n')[0], PUBLIC_RELEASE_DETAILS: message.split('\n').slice(2).join('\n'), GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-source|fixture-public/);
    return (await readFile(log, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  };
  const before = allRefs(f);
  const dry = await run(false);
  assert.deepEqual(allRefs(f), before);
  assert.deepEqual(dry.filter(c => c.kind === 'api').map(c => c.path).sort(), ['/repos/' + PUBLIC, '/user']);
  assert.equal(dry.filter(c => c.push).length, 0);
  const live = await run(true);
  assert.deepEqual(live.filter(c => c.push), [{kind:'git', role:'public', push:true, atomic:true}]);
  assert.equal(git(f.publicUrl, ['rev-parse', 'refs/tags/v0.9.2']), head(f.publicUrl));
  const retry = await run(true);
  assert.equal(retry.filter(c => c.push).length, 0);
});
