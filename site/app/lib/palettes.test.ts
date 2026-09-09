import assert from 'node:assert/strict';
import test from 'node:test';
import { paletteFamily, palettes, paletteVariant } from './palettes';

test('docs palette menu exposes only complete light and dark theme families', () => {
  assert.deepEqual(palettes.map(palette => palette.id), ['neutral', 'vitesse', 'github']);
  for (const palette of palettes) if (palette.id !== 'neutral') {
    assert.ok(palette.light.endsWith('-light'));
    assert.ok(palette.dark.endsWith('-dark'));
  }
});

test('docs palettes migrate legacy variant preferences and resolve the active appearance', () => {
  assert.equal(paletteFamily('vitesse-light'), 'vitesse');
  assert.equal(paletteFamily('github-dark'), 'github');
  assert.equal(paletteVariant('vitesse', 'light'), 'vitesse-light');
  assert.equal(paletteVariant('vitesse', 'dark'), 'vitesse-dark');
  assert.equal(paletteVariant('github', 'light'), 'github-light');
  assert.equal(paletteVariant('github', 'dark'), 'github-dark');
});
