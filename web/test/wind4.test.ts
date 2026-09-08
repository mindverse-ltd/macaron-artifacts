import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createGenerator } from '@unocss/core';
import { unoConfig } from '../../artifacts/src/web/theme/uno.js';

const generator = () => createGenerator(unoConfig());

test('Wind4 preserves host geometry, opacity colors and accessible focus utilities', async () => {
  const uno = await generator();
  const tokens = ['rounded-lg', 'rounded-sm', 'shadow-xs', 'outline-hidden', 'ring-2', 'ring-accent', 'ring-offset-surface', 'text-accent-fg', 'border-border', 'border-black/8', 'bg-[#F1EFE9]/82', 'bg-white/72', 'h-[--cell-size]', 'data-[state=open]:animate-in'];
  const result = await uno.generate(tokens.join(' '));
  assert.deepEqual(new Set(result.matched), new Set(tokens));
  assert.doesNotMatch(result.css, /--macaron-/);
  assert.match(result.css, /0 1px 2px 0 var\(--un-shadow-color, rgb\(0 0 0 \/ 0\.05\)\)/);
  assert.match(result.css, /@media \(forced-colors: active\)/);
  assert.match(result.css, /outline:2px solid transparent;outline-offset:2px/);
  assert.match(result.css, /@property --un-ring-shadow/);
  assert.match(result.css, /var\(--accent-fg\)/);
  assert.match(result.css, /var\(--colors-black\) 8%, transparent/);
  assert.match(result.css, /#F1EFE9 82%, transparent/);
  assert.match(result.css, /var\(--surface\)/);
});

test('later streaming tokens receive their theme variables and property registrations', async () => {
  const uno = await generator();
  await uno.generate('p-4 text-sm');
  const result = await uno.generate('p-4 text-sm text-7xl bg-rose-700 ring-2');
  assert.match(result.css, /--text-7xl-fontSize: 4\.5rem/);
  assert.match(result.css, /--colors-rose-700: oklch\(/);
  assert.match(result.css, /@property --un-ring-shadow/);
  assert.ok(result.layers.indexOf('properties') < result.layers.indexOf('theme'));
  assert.ok(result.layers.indexOf('theme') < result.layers.indexOf('base'));
});

test('all legacy entries load one shared Wind4 runtime before their application styles', async () => {
  for (const entry of ['main.tsx', 'codex/main.tsx', 'kimi/main.tsx']) {
    const source = await readFile(new URL(`../src/${entry}`, import.meta.url), 'utf8');
    assert.ok(source.indexOf('lib/uno-runtime') < source.indexOf("import './styles.css'"), entry);
    assert.doesNotMatch(source, /@unocss\/reset|presetWind3/);
  }
  const base = await readFile(new URL('../src/genui.css', import.meta.url), 'utf8');
  assert.doesNotMatch(base, /@apply/);
  assert.match(base, /--border:/);
  for (let index = 1; index <= 6; index++) assert.match(base, new RegExp(`--series-${index}:`));
  assert.doesNotMatch(base, /--macaron-/);
});
