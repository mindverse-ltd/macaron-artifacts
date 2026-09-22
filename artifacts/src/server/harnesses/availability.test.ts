import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { openCodeAdapter } from './opencode.js';
import { piAdapter } from './pi.js';
import { hermesAdapter } from './hermes.js';
import { openClawAdapter } from './openclaw.js';
import { createArtifactsServer } from '../index.js';

const originalEnv = { ...process.env }, exec = promisify(execFile), node = Bun.which('node')!;
let temporary: string;
beforeEach(async () => {
  process.env = { ...originalEnv };
  for (const key of ['MACARON_CLAUDE_PATH', 'MACARON_CODEX_PATH', 'MACARON_OPENCODE_PATH', 'MACARON_HERMES_PATH', 'MACARON_HERMES_URL']) delete process.env[key];
  temporary = await mkdtemp(join(tmpdir(), 'harness-availability-'));
  process.env.CODEX_HOME = join(temporary, 'codex-home');
});
afterEach(async () => { process.env = { ...originalEnv }; await rm(temporary, { recursive: true, force: true }); });
async function cli(name: string, body = 'console.log("fixture 1.0.0")') {
  const path = join(temporary, name);
  await writeFile(path, `#!${process.execPath}\n${body}\n`); await chmod(path, 0o755); return path;
}

test('bundled runtimes work with no harness commands on PATH', async () => {
  process.env.PATH = '';
  for (const adapter of [claudeAdapter, piAdapter, openClawAdapter]) {
    const info = await adapter.info();
    expect(info.available).toBe(true);
    expect(info.detail).toContain('内置');
  }
  for (const adapter of [codexAdapter, openCodeAdapter, hermesAdapter]) expect((await adapter.info()).available).toBe(false);
});

test('authoritative native overrides accept PATH commands but reject missing/nonzero commands', async () => {
  const binary = await cli('fixture-claude');
  process.env.PATH = temporary;
  process.env.MACARON_CLAUDE_PATH = 'fixture-claude';
  expect((await claudeAdapter.info()).available).toBe(true);
  process.env.MACARON_CLAUDE_PATH = join(temporary, 'missing');
  expect((await claudeAdapter.info()).available).toBe(false);
  process.env.MACARON_CLAUDE_PATH = await cli('broken', 'process.exit(7)');
  expect((await claudeAdapter.info()).available).toBe(false);
  process.env.MACARON_CODEX_PATH = binary;
  process.env.MACARON_OPENCODE_PATH = binary;
  process.env.MACARON_HERMES_PATH = binary;
  for (const adapter of [codexAdapter, openCodeAdapter, hermesAdapter]) expect((await adapter.info()).available).toBe(true);
});

test('script override checks the actual script, not just the interpreter', async () => {
  process.env.MACARON_CLAUDE_PATH = await cli('claude.mjs');
  expect((await claudeAdapter.info()).source).toBe('script');
  expect((await claudeAdapter.info()).available).toBe(true);
  process.env.MACARON_CLAUDE_PATH = join(temporary, 'missing.mjs');
  expect((await claudeAdapter.info()).available).toBe(false);
  process.env.MACARON_CLAUDE_PATH = await cli('broken.mjs', 'process.exit(7)');
  expect((await claudeAdapter.info()).available).toBe(false);
  process.env.MACARON_CLAUDE_PATH = await cli('claude.mjs');
  process.env.PATH = '';
  expect((await claudeAdapter.info()).available).toBe(false); // SDK also needs its named interpreter.
});

test('version probes are bounded and reject a hanging executable', async () => {
  process.env.MACARON_CLAUDE_PATH = await cli('hanging', 'setInterval(() => {}, 1000)');
  expect((await claudeAdapter.info()).available).toBe(false);
}, 10_000);

// Each loader fault runs in a fresh Node process. No shared module mocks or package-store mutation.
for (const [file, adapter, blocked] of [
  ['pi', 'piAdapter', '@earendil-works/pi-coding-agent'],
  ['openclaw', 'openClawAdapter', '@openclaw/gateway-client'],
  ['claude', 'claudeAdapter', '@anthropic-ai/claude-agent-sdk'],
] as const) {
  test(`${adapter} fails closed when ${blocked} is missing`, async () => {
    const code = `import { registerHooks } from 'node:module';
      let denied = 0;
      const missing = value => decodeURIComponent(value).includes(${JSON.stringify(blocked)});
      registerHooks({ resolve(s,c,next) {
        if(missing(s)) { denied++; throw Error('fixture missing dependency'); }
        const resolved = next(s,c);
        if(missing(resolved.url)) { denied++; throw Error('fixture missing dependency'); }
        return resolved;
      } });
      const {${adapter}} = await import(${JSON.stringify(new URL(`./${file}.ts`, import.meta.url).href)});
      console.log(JSON.stringify({ info: await ${adapter}.info(), denied }));`;
    const { stdout } = await exec(node, ['--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', code], { env: process.env, timeout: 15_000 });
    const result = JSON.parse(stdout);
    expect(result.denied).toBeGreaterThan(0);
    expect(result.info.available).toBe(false);
  }, 20_000);
}

test('Claude SDK importable without its optional native package is unavailable', async () => {
  const sdkRoot = dirname(fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk')));
  const fixtureSdk = join(temporary, 'node_modules/@anthropic-ai/claude-agent-sdk');
  await cp(sdkRoot, fixtureSdk, { recursive: true });
  // Mask both libc candidates to prevent an ancestor installation satisfying the fixture.
  for (const suffix of [`${process.platform}-${process.arch}`, `linux-${process.arch}-musl`, `linux-${process.arch}-android`]) {
    const dir = join(temporary, 'node_modules/@anthropic-ai', `claude-agent-sdk-${suffix}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ exports: { './claude': './missing', './claude.exe': './missing' } }));
  }
  const built = await Bun.build({ entrypoints: [fileURLToPath(new URL('./claude-availability.ts', import.meta.url))], outdir: temporary, naming: 'availability.mjs', target: 'node', format: 'esm', packages: 'external' });
  expect(built.success).toBe(true);
  const code = `const sdk = await import(${JSON.stringify(pathToFileURL(join(fixtureSdk, 'sdk.mjs')).href)});
    const {claudeRuntimeInfo} = await import(${JSON.stringify(pathToFileURL(join(temporary, 'availability.mjs')).href)});
    console.log(JSON.stringify({ imported: typeof sdk.query === 'function', info: await claudeRuntimeInfo() }));`;
  const { stdout } = await exec(node, ['--input-type=module', '--eval', code], { env: process.env, timeout: 15_000 });
  const result = JSON.parse(stdout);
  expect(result.imported).toBe(true);
  expect(result.info.available).toBe(false);
});

test('Hermes gateway selection matches run precedence and never exposes URL credentials', async () => {
  process.env.PATH = '';
  process.env.MACARON_HERMES_URL = 'ws://user:secret@example.invalid/?token=hidden';
  const info = await hermesAdapter.info();
  expect(info.available).toBe(true);
  expect(info.source).toBe('gateway');
  expect(info.detail).not.toContain('secret'); expect(info.detail).not.toContain('hidden');
  expect((await hermesAdapter.info({ config: { gatewayUrl: 'not-a-url' } })).available).toBe(false);
  process.env.MACARON_HERMES_URL = 'invalid';
  expect((await hermesAdapter.info({ config: { gatewayUrl: 'ws://127.0.0.1:1' } })).available).toBe(true);
});

test('HTTP rejects unavailable sessions without saving, but accepts a saved remote-only profile', async () => {
  process.env.PATH = '';
  const app = await createArtifactsServer({ directory: join(temporary, 'sessions'), instructions: '', harnesses: { codex: codexAdapter, hermes: hermesAdapter, pi: piAdapter } });
  try {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const request = (path: string, body?: unknown) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect((await request('/api/sessions', { harness: 'codex', cwd: temporary })).status).toBe(503);
    expect(await (await request('/api/sessions')).json()).toEqual([]);
    expect((await request('/api/sessions', { harness: 'hermes', cwd: temporary, profileId: 'missing' })).status).toBe(404);
    const created = await request('/api/profiles', { harness: 'hermes', name: 'Remote fixture', config: { gatewayUrl: 'ws://127.0.0.1:1' } });
    expect(created.status).toBe(201);
    const profile = await created.json();
    const infos = await (await request('/api/harnesses')).json();
    expect(infos.find((info: { id: string }) => info.id === 'hermes').available).toBe(true);
    expect((await request('/api/sessions', { harness: 'hermes', cwd: temporary })).status).toBe(503);
    const sessionResponse = await request('/api/sessions', { harness: 'hermes', cwd: temporary, profileId: profile.id });
    expect(sessionResponse.status).toBe(201);
    const session = await sessionResponse.json();
    expect((await (await request(`/api/sessions/${session.id}`)).json()).profileId).toBe(profile.id);
    expect((await (await request('/api/sessions')).json()).length).toBe(1);
    expect((await request('/api/sessions', { harness: 'pi', cwd: temporary })).status).toBe(201);
  } finally { await app.close(); }
});
