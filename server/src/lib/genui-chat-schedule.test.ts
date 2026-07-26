import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGenUI } from './genui-check.js';

// The commit-gate widget shape from the ask-via-ui skill. `scheduleUserMessage`
// only exists as an ambient declaration (the runtime side is a .mjs shim with no
// .tsx to map through compilerOptions.paths), so without it the exact code we
// tell the model to write comes back as a TS2307 and the model "fixes" a
// non-problem. Both facts are checked here: the import resolves, and the
// signature is real enough to reject a wrong call.
const commitGate = (call: string) => `import { useEffect, useRef, useState } from 'react';
import { Button } from '$macaron/ui';
import { sendUserMessage, scheduleUserMessage } from '$macaron/chat';

export default function App() {
  const [left, setLeft] = useState<number | null>(null);
  const cancel = useRef<() => void>(() => {});
  useEffect(() => {
    cancel.current = ${call};
    return () => cancel.current();
  }, []);
  return <Button onClick={() => { cancel.current(); sendUserMessage('Commit it.'); }}>Commit{left !== null ? \` (\${left}s)\` : ''}</Button>;
}
`;

test('accepts the countdown commit gate we document', async () => {
  assert.deepEqual(await checkGenUI(commitGate("scheduleUserMessage('Commit it.', 30, setLeft)")), { ok: true });
});

test('the ambient scheduleUserMessage signature is typed, not any', async () => {
  const result = await checkGenUI(commitGate("scheduleUserMessage(30, 'Commit it.')"));

  assert.equal(result.ok, false);
  assert.match(result.diagnostics ?? '', /not assignable to parameter of type 'string'/);
});
