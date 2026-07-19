import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolHeader, bashCommand, isToolExpandable } from '../src/lib/toolHeader';

const PREVIEW = 2;

test('Bash header prefers description over the raw command', () => {
  assert.equal(toolHeader('Bash', { command: 'ls -la', description: 'List files' }), 'List files');
});

test('Bash header falls back to the command when description is missing', () => {
  assert.equal(toolHeader('Bash', { command: 'ls -la' }), 'ls -la');
});

test('Bash header falls back to the command when description is empty', () => {
  assert.equal(toolHeader('Bash', { command: 'ls -la', description: '' }), 'ls -la');
});

test('bashCommand returns the raw script verbatim (multiline preserved)', () => {
  const command = 'set -e\ncd /tmp\nls -la';
  assert.equal(bashCommand('Bash', { command, description: 'List files' }), command);
});

test('bashCommand is empty for non-Bash tools', () => {
  assert.equal(bashCommand('Read', { file_path: '/a/b.ts' }), '');
});

test('bashCommand is empty when the Bash call has no command', () => {
  assert.equal(bashCommand('Bash', { description: 'noop' }), '');
});

test('a Bash call with no output is still expandable so its script is reachable', () => {
  const command = 'nohup ./long-job.sh &';
  assert.equal(isToolExpandable(command, 0, PREVIEW), true);
});

test('a Bash call with short output stays expandable for the script', () => {
  // 1 output line (< preview) would not expand on its own, but the script must be reachable.
  assert.equal(isToolExpandable('echo hi', 1, PREVIEW), true);
});

test('a non-Bash tool expands only when output overflows the preview', () => {
  assert.equal(isToolExpandable('', 2, PREVIEW), false);
  assert.equal(isToolExpandable('', 3, PREVIEW), true);
});
