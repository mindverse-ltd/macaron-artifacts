import { expect, test } from 'bun:test';
import { selectionDraft } from './selection-draft';

test('selection actions preserve the draft and quote every selected line', () => {
  expect(selectionDraft('Keep my draft\n', 'First line\n\nSecond line', 'explain')).toBe('Keep my draft\n\n\n请解释这段内容：\n\n> First line\n> \n> Second line');
  expect(selectionDraft('', 'Selected answer', 'modify')).toEndWith('> Selected answer\n\n修改要求：');
  expect(selectionDraft('', 'Selected answer', 'followup')).toEndWith('> Selected answer\n\n我的问题：');
});
