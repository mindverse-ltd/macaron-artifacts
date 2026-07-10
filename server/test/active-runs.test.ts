import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abortRun, claimRun, isRunActive } from '../src/lib/active-runs.js';

test('claimRun preserves the active controller when a second turn races it', () => {
  const sid = `claim-${Date.now()}-${Math.random()}`;
  const loopController = new AbortController();
  const messageController = new AbortController();

  assert.equal(claimRun(sid, loopController), true);
  assert.equal(claimRun(sid, messageController), false);
  assert.equal(isRunActive(sid), true);

  assert.equal(abortRun(sid), true);
  assert.equal(loopController.signal.aborted, true);
  assert.equal(messageController.signal.aborted, false);
  assert.equal(isRunActive(sid), false);
});
