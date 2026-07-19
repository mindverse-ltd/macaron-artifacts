import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolHeader, toolSubHeader } from '../src/lib/toolHeader';

test('Bash header is the raw command (the main line)', () => {
  assert.equal(toolHeader('Bash', { command: 'ls -la', description: 'List files' }), 'ls -la');
});

test('Bash header falls back to the description when the command is missing', () => {
  assert.equal(toolHeader('Bash', { description: 'List files' }), 'List files');
});

test('Bash subheader is the description (the gray helper line)', () => {
  assert.equal(toolSubHeader('Bash', { command: 'ls -la', description: 'List files' }), 'List files');
});

test('Bash subheader is empty when description is missing', () => {
  assert.equal(toolSubHeader('Bash', { command: 'ls -la' }), '');
});

test('Bash subheader is empty when description is empty', () => {
  assert.equal(toolSubHeader('Bash', { command: 'ls -la', description: '' }), '');
});

test('Bash subheader is empty when there is no command to subordinate to', () => {
  assert.equal(toolSubHeader('Bash', { description: 'List files' }), '');
});
