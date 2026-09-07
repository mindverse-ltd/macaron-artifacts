import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatCodeDeltaStream, renderChatCodeToHtml } from '../src/lib/chatCodeHighlighter.ts';

test('cached code highlights stay isolated between Shiki palettes', async () => {
  const code = 'const greeting = "hello";';
  const light = await renderChatCodeToHtml(code, 'javascript', 'github-light');
  const dark = await renderChatCodeToHtml(code, 'javascript', 'nord');
  assert.notEqual(light, dark);
  assert.equal(await renderChatCodeToHtml(code, 'javascript', 'github-light'), light);
});

test('streaming code uses the selected Shiki palette', async () => {
  const source = createChatCodeDeltaStream('javascript', 'nord');
  source.push('const answer = '); source.push('42;'); source.close();
  const tokens = [];
  for await (const token of source.stream) tokens.push(token);
  assert.ok(tokens.length > 0);
  assert.match(JSON.stringify(tokens).toLowerCase(), /81a1c1|b48ead|d8dee9/);
});
