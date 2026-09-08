import { expect, test } from 'bun:test';
import { readableForeground, readableMutedForeground, themePalette } from './themes';
import vitesseLight from '@shikijs/themes/vitesse-light';
import vitesseDark from '@shikijs/themes/vitesse-dark';

test('Shiki editor button tokens receive a readable foreground on a web UI', () => {
  expect(readableForeground('#159739', '#fff')).toBe('#000000');
  expect(readableForeground('#24292e', '#fff')).toBe('#fff');
  expect(readableForeground('#ffffff', '#16161a')).toBe('#16161a');
  expect(readableForeground('#ffffff', '#00000080')).toBe('#000000');
});

test('Shiki alpha description colors remain readable after compositing', () => {
  expect(readableMutedForeground('#ffffff', '#393a3490')).toBe('#393a34');
  expect(readableMutedForeground('#121212', '#dedcd590')).toBe('#dedcd590');
});

test('shipped Vitesse palettes expose readable muted tokens', () => {
  expect(themePalette(vitesseLight, false).muted).toBe('#393a34');
  expect(themePalette(vitesseDark, true).muted).toBe('#dedcd590');
});
