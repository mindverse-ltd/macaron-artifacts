import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

function fixture(t, location = 'checkout') {
  const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'macaron startup ')));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const source = path.join(home, location);
  const bin = path.join(temp, 'bin');
  const calls = path.join(temp, 'calls');
  const launch = path.join(temp, 'launch.json');
  for (const dir of [bin, source, ...['web', 'server', 'shared'].map(name => path.join(source, name, 'src'))]) mkdirSync(dir, { recursive: true });
  copyFileSync(new URL('../start.sh', import.meta.url), path.join(source, 'start.sh'));
  writeFileSync(path.join(source, 'package.json'), '{"version":"0.1.0"}');
  writeFileSync(path.join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  writeFileSync(calls, '');
  const program = path.join(temp, 'server.cjs');
  writeFileSync(program, `require('node:fs').writeFileSync(process.env.START_TEST_LAUNCH, JSON.stringify({ cwd:process.cwd(), engine:process.env.MACARON_ENGINE, port:process.env.MACARON_PORT, model:process.env.START_TEST_MODEL })); process.exit(Number(process.env.START_TEST_EXIT || 0));`);
  symlinkSync(process.execPath, path.join(bin, 'node'));
  // Exercise the complete launcher, stubbing only package installation and
  // network/port probes so the tests cannot install tools or kill a listener.
  for (const [name, body] of Object.entries({
    npm: 'printf "%s\\n" "$*" >> "$START_TEST_CALLS"\nif [ "${*: -2}" = "run build" ]; then mkdir -p server/dist web/dist; cp "$START_TEST_PROGRAM" server/dist/index.js; echo ready > web/dist/index.html; fi',
    lsof: 'exit 1', curl: 'exit 0', sleep: 'exit 0',
  })) writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
  const run = (extra = {}) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(MACARON_|START_TEST_|NODE_OPTIONS$|BASH_ENV$)/.test(key)) delete env[key];
    const result = spawnSync('/bin/bash', [path.join(source, 'start.sh')], {
      cwd: temp, encoding: 'utf8', timeout: 10_000,
      env: { ...env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, MACARON_FOREGROUND: '1', MACARON_AUTO_INSTALL_NODE: '0', START_TEST_CALLS: calls, START_TEST_LAUNCH: launch, START_TEST_PROGRAM: program, ...extra },
    });
    return { ...result, launched: existsSync(launch) ? JSON.parse(readFileSync(launch, 'utf8')) : null };
  };
  return { home, source, run, calls: () => readFileSync(calls, 'utf8').trim().split('\n') };
}

test('cold launch installs/builds once; warm launch reuses them; changed source rebuilds', t => {
  const f = fixture(t);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(f.calls(), ['exec --yes --package=pnpm@latest -- pnpm install --frozen-lockfile', 'exec --yes --package=pnpm@latest -- pnpm run build']);
  assert.equal(f.run().status, 0);
  assert.equal(f.calls().length, 2);
  const changed = path.join(f.source, 'server/src/changed.ts');
  writeFileSync(changed, '// updated source\n');
  const later = new Date(Date.now() + 2000);
  utimesSync(changed, later, later);
  assert.equal(f.run().status, 0);
  assert.equal(f.calls().length, 3);
  assert.match(f.calls()[2], /run build$/);
});

test('shell .env expansion and precedence survive explicit launch overrides', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.source, '.env'), 'MACARON_ENGINE=kimi\nMACARON_PORT=7980\nMACARON_FOREGROUND=0\nSTART_TEST_MODEL="${START_TEST_BASE}-file"\n');
  const result = f.run({ MACARON_ENGINE:'codex', MACARON_PORT:'49797', START_TEST_BASE:'expanded', START_TEST_MODEL:'ambient' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.launched, { cwd:f.source, engine:'codex', port:'49797', model:'expanded-file' });
});

for (const location of ['.claude/plugins/cache/macaron', '.codex/plugins/cache/macaron', '.kimi-code/plugins/managed/macaron']) {
  test(`${location}: source is mirrored outside the disposable plugin cache`, t => {
    const f = fixture(t, location);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const runtime = path.join(f.home, '.macaron/runtime/0.1.0');
    assert.equal(result.launched.cwd, runtime);
    assert.equal(existsSync(path.join(f.source, 'node_modules')), false);
    rmSync(f.source, { recursive: true });
    assert.equal(readFileSync(path.join(runtime, 'web/dist/index.html'), 'utf8'), 'ready\n');
    assert.ok(existsSync(path.join(runtime, 'server/dist/index.js')));
  });
}

test('foreground launch propagates the server exit status', t => {
  const result = fixture(t).run({ START_TEST_EXIT:'37' });
  assert.equal(result.status, 37, result.stderr);
});
