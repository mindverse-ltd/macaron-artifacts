import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'macaron pnpm '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(path.join(root, 'scripts'));
  const script = path.join(root, 'scripts/pnpm.sh');
  copyFileSync(new URL('./pnpm.sh', import.meta.url), script);
  symlinkSync(process.execPath, path.join(bin, 'node'));
  const manifest = (dir, major) => writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devEngines: { packageManager: { name: 'pnpm', version: major, onFail: 'warn' } } }));
  manifest(root, '12');
  // Any accidental fallback to the caller's old pnpm or Corepack must fail.
  for (const name of ['pnpm', 'corepack']) writeFileSync(path.join(bin, name), '#!/bin/bash\nexit 99\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'npm'), `#!/bin/bash
set -eu
[ "\$1" = install ] && [ "\$2" = --prefix ]
prefix="\$3"
printf '%s\\n' "\$*" >> "$BOOTSTRAP_TEST_LOG"
[ "\$BOOTSTRAP_TEST_FAIL" != 1 ] || exit 42
mkdir -p "$prefix/node_modules/.bin"
major="\${!#}"
major="\${major#pnpm@}"
cat > "$prefix/node_modules/.bin/pnpm" <<EOF
#!/bin/bash
if [ "\\\$1" = --version ]; then echo "$major.3.4"; else exec "\\\$@"; fi
EOF
chmod +x "$prefix/node_modules/.bin/pnpm"
`, { mode: 0o755 });
  const log = path.join(root, 'installs.log');
  const run = (args = ['--version'], cwd = root, extraEnv = {}) => spawnSync('/bin/bash', [script, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, BOOTSTRAP_TEST_LOG: log, BOOTSTRAP_TEST_FAIL: '0', ...extraEnv },
  });
  return { root, run, manifest, installs: () => readFileSync(log, 'utf8').trim().split('\n') };
}

test('bootstraps without global pnpm and preserves the major-range manifest', (t) => {
  const { root, run, installs } = fixture(t);
  const before = readFileSync(path.join(root, 'package.json'), 'utf8');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '12.3.4');
  assert.match(installs()[0], /pnpm@12$/);
  assert.equal(readFileSync(path.join(root, 'package.json'), 'utf8'), before);
});

test('warm runs reuse the cache and nested commands receive the same pnpm', (t) => {
  const { run, installs } = fixture(t);
  assert.equal(run().status, 0);
  const result = run(['bash', '-c', 'pnpm --version; printf "%s" "$1"', 'test', 'argument with spaces'], undefined, { BOOTSTRAP_TEST_FAIL: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '12.3.4\nargument with spaces');
  assert.equal(installs().length, 1);
});

test('the standalone site selects its own declared major from a separate invocation', (t) => {
  const { root, run, manifest, installs } = fixture(t);
  assert.equal(run().status, 0);
  const site = path.join(root, 'site');
  mkdirSync(site);
  manifest(site, '13');
  const result = run(['--version'], site);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '13.3.4');
  assert.match(installs()[1], /pnpm@13$/);
});

test('installation failure stops before invoking an old global pnpm', (t) => {
  const { run } = fixture(t);
  const result = run(['--version'], undefined, { BOOTSTRAP_TEST_FAIL: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not install pnpm@12/);
  assert.equal(result.stdout, '');
});
