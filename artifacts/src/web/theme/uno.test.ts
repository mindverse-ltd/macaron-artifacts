import { expect, test } from 'bun:test';
import { createGenerator } from '@unocss/core';
import { unoConfig } from './uno';

test('Wind4 owns the shell reset and scoped surfaces inherit it', async () => {
  const shell = await createGenerator(unoConfig());
  expect((await shell.generate('outline-none ring-2')).getLayer('base')).toMatch(/box-sizing:\s*border-box/);
  const surface = await createGenerator(unoConfig('.ui4a-surface'));
  const result = await surface.generate('outline-none ring-2 animate-in fade-in');
  expect(result.getLayer('base')).toBe('');
  for (const token of ['outline-none', 'ring-2', 'animate-in', 'fade-in']) expect(result.css).toContain(`.ui4a-surface :is(.${token})`);
});

test('late streaming utilities include their Wind4 theme and ring dependencies', async () => {
  const surface = await createGenerator(unoConfig('.ui4a-surface'));
  await surface.generate('p-2');
  const result = await surface.generate('bg-rose-700 text-7xl ring-2 ring-rose-700 shadow-xl');
  const preflights = result.getLayers(['properties', 'theme']);
  expect(preflights).toContain('--colors-rose-700:');
  expect(preflights).toContain('--text-7xl-fontSize:');
  expect(preflights).toContain('--un-ring-offset-width');
  expect(result.getLayers(undefined, ['properties', 'theme'])).not.toMatch(/box-sizing:\s*border-box/);
});
