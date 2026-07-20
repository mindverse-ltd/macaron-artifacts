import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

// Isolate HOME before importing settings-store: CONFIG_PATH is captured at
// module load from ~/.claude/macaron-config.json, so a temp HOME keeps these
// tests off the real config.
process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'macaron-env-'));

const store = await import('../src/lib/settings-store.js');

// The launch override is captured once per warmSettingsCache() call from the
// ambient env, so each test sets env then re-warms to simulate a fresh boot.
async function boot(env: { base?: string; model?: string }) {
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_MODEL;
  if (env.base) process.env.ANTHROPIC_BASE_URL = env.base;
  if (env.model) process.env.ANTHROPIC_MODEL = env.model;
  await store.warmSettingsCache();
}

async function seedCustomActive() {
  const p = await store.addProvider({ name: 'Stored', endpoint: 'https://api.example.com/v1', model: 'stored-model', apiKey: 'sk-test' });
  await store.setActiveProvider(p.id);
  return p;
}

beforeEach(async () => {
  // Reset persisted state to a known System-active baseline between tests.
  await boot({});
  await store.setActiveProvider(store.SYSTEM_PROVIDER_ID);
});

test('System launch passes ambient ANTHROPIC_MODEL through with no env override', async () => {
  await boot({ model: 'Macaron-V1-Venti' });
  const { model, env } = store.getActiveProviderEnv();
  assert.equal(model, 'Macaron-V1-Venti');
  assert.equal(env, null);
});

test('System launch with no ambient model yields undefined', async () => {
  await boot({});
  const { model, env } = store.getActiveProviderEnv();
  assert.equal(model, undefined);
  assert.equal(env, null);
});

test('active custom provider builds a relay env override', async () => {
  await boot({});
  await seedCustomActive();
  const { model, env } = store.getActiveProviderEnv();
  assert.equal(model, 'stored-model');
  assert.ok(env);
  assert.match(env!.ANTHROPIC_BASE_URL, /\/relay\/anthropic\//);
});

test('base-URL launch overrides a stale persisted custom provider (route + UI agree)', async () => {
  await seedCustomActive();
  await boot({ base: 'https://mint.macaron.im', model: 'Macaron-V1-Venti' });
  const { model, env } = store.getActiveProviderEnv();
  assert.equal(model, 'Macaron-V1-Venti');
  assert.equal(env, null); // pass-through, not the relay
  const pub = await store.readPublicSettings();
  assert.equal(pub.activeProviderId, store.SYSTEM_PROVIDER_ID); // UI shows System too
});

test('model-only launch overrides a stale persisted custom provider', async () => {
  await seedCustomActive();
  await boot({ model: 'cli-model' }); // no ambient base URL
  const { model, env } = store.getActiveProviderEnv();
  assert.equal(model, 'cli-model');
  assert.equal(env, null);
  const pub = await store.readPublicSettings();
  assert.equal(pub.activeProviderId, store.SYSTEM_PROVIDER_ID);
});

test('selecting a custom provider clears the launch override and restores isolation', async () => {
  const p = await seedCustomActive();
  await boot({ base: 'https://mint.macaron.im', model: 'Macaron-V1-Venti' });
  // UI initially agrees on System while launched with ambient env.
  assert.equal((await store.readPublicSettings()).activeProviderId, store.SYSTEM_PROVIDER_ID);
  // Explicit selection retires the override.
  await store.setActiveProvider(p.id);
  const { model, env } = store.getActiveProviderEnv();
  assert.equal(model, 'stored-model');
  assert.ok(env);
  assert.match(env!.ANTHROPIC_BASE_URL, /\/relay\/anthropic\//); // relay isolation restored
  assert.equal((await store.readPublicSettings()).activeProviderId, p.id); // UI shows the provider
});
