import { expect, test } from 'bun:test';
import { readableForeground } from './themes';

test('Shiki editor button tokens receive a readable foreground on a web UI', () => {
  expect(readableForeground('#159739', '#fff')).toBe('#000000');
  expect(readableForeground('#24292e', '#fff')).toBe('#fff');
  expect(readableForeground('#ffffff', '#16161a')).toBe('#16161a');
});
