import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const pathToFileURLString = (p: string) => pathToFileURL(p).href;

// Proves the per-engine dependency split: each launcher boots the shared
// `server/dist/index.js` while the OTHER engines' SDKs are absent. We can't
// uninstall packages from a shared node_modules mid-suite, so we simulate a
// fresh, engine-scoped install with a loader `resolve` hook that makes the
// forbidden SDK specifiers throw ERR_MODULE_NOT_FOUND — exactly what a tarball
// that never declared them would do. A boot that still reaches "listening"
// proves those SDKs are never touched on that engine's boot path.

const repoRoot = path.resolve(import.meta.dirname, '../..');
const bundle = path.join(repoRoot, 'server', 'dist', 'index.js');

const CLAUDE = '@anthropic-ai/claude-agent-sdk';
const CODEX = '@openai/codex-sdk';
const ACP = '@agentclientprotocol/sdk';

// Boots the bundle with `blocked` SDKs made unresolvable and `MACARON_ENGINE`
// set, then resolves once the server logs it is listening (success) or the
// child exits early (failure — e.g. a boot-path import of a blocked SDK).
function bootWithBlocked(engine: string | undefined, blocked: string[]): Promise<{ ok: boolean; output: string }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'engine-iso-'));
  // The blocking `resolve` hook must run on the loader thread, registered via
  // module.register — an `--import`ed module's exported `resolve` is NOT picked
  // up as a hook (it just runs for side effects). So we register a hooks module
  // from a tiny bootstrap that `--import` loads before the bundle.
  const hooks = path.join(dir, 'block-hooks.mjs');
  writeFileSync(hooks, `
    const blocked = new Set(${JSON.stringify(blocked)});
    export async function resolve(specifier, context, next) {
      if (blocked.has(specifier)) {
        const err = new Error(\`Cannot find package '\${specifier}' (blocked for test)\`);
        err.code = 'ERR_MODULE_NOT_FOUND';
        throw err;
      }
      return next(specifier, context);
    }
  `);
  const bootstrap = path.join(dir, 'register.mjs');
  writeFileSync(bootstrap, `
    import { register } from 'node:module';
    import { pathToFileURL } from 'node:url';
    register(${JSON.stringify(pathToFileURLString(hooks))}, pathToFileURL('./'));
  `);

  const env = { ...process.env };
  delete env.MACARON_ENGINE;
  if (engine) env.MACARON_ENGINE = engine;
  // A random high port and a throwaway HOME keep parallel boots off each other
  // and off the real ~/.claude config.
  env.MACARON_PORT = String(20000 + Math.floor(Math.random() * 20000));
  env.HOME = dir;

  const child = spawn(process.execPath, ['--import', bootstrap, bundle], { cwd: repoRoot, env });

  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ ok, output });
    };
    const onData = (b: Buffer) => {
      output += b.toString('utf8');
      if (output.includes('macaron server listening')) done(true);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => done(false)); // exited before "listening" → boot failed
    const timer = setTimeout(() => done(false), 15000);
  });
}

test('mcc (claude) boots without the codex or ACP SDKs installed', async () => {
  const { ok, output } = await bootWithBlocked(undefined, [CODEX, ACP]);
  assert.ok(ok, `claude boot did not reach listening:\n${output}`);
});

test('mcx (codex) boots without the claude or ACP SDKs installed', async () => {
  const { ok, output } = await bootWithBlocked('codex', [CLAUDE, ACP]);
  assert.ok(ok, `codex boot did not reach listening:\n${output}`);
});

test('mkx (kimi) boots without the claude or codex SDKs installed', async () => {
  const { ok, output } = await bootWithBlocked('kimi', [CLAUDE, CODEX]);
  assert.ok(ok, `kimi boot did not reach listening:\n${output}`);
});
