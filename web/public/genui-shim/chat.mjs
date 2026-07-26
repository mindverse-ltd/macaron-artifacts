// $macaron/chat shim — lets a sandboxed render_ui widget post a message back into
// the chat, as if the user typed it (driving the next assistant turn). Mirrors
// macaron-genui-demo's $macaron/chat / sendUserMessage. The host registers a
// dispatcher on globalThis['$app/chat'] (see Session.tsx); the preview
// renders inline (not an iframe) so it shares globalThis with the host. No active
// bridge = no-op + warn, matching display-only widget semantics.
const dispatch = (text) => {
  const bridge = globalThis['$app/chat'];
  if (!bridge) { console.warn('[genui-shim/chat] no active chat bridge; message dropped'); return; }
  bridge(text);
};

export function sendUserMessage(prompt) {
  if (typeof prompt !== 'string') throw new TypeError('sendUserMessage expects a string prompt');
  dispatch(prompt);
}

// Countdown auto-send for confirm widgets with a default option ("commit unless
// you say otherwise"). The host owns the timer (globalThis['$app/chat/schedule'],
// see lib/autoSend.ts) so it can refuse to fire on a re-opened transcript and
// hold while a turn is still streaming — neither is observable from in here.
// Returns a cancel function; call it from onClick when the user picks manually.
export function scheduleUserMessage(prompt, seconds, onTick) {
  if (typeof prompt !== 'string') throw new TypeError('scheduleUserMessage expects a string prompt');
  const schedule = globalThis['$app/chat/schedule'];
  if (!schedule) { console.warn('[genui-shim/chat] no active chat bridge; countdown dropped'); return () => {}; }
  return schedule(prompt, seconds, onTick);
}

// Side-effect: also expose sendUserMessage on globalThis so widgets that
// forget the `import` still work — the preview shares globalThis with the
// host, so any onClick handler can just call sendUserMessage(...) directly.
// Models empirically forget the import ~30% of the time; the ReferenceError
// this saved isn't recoverable at runtime otherwise.
if (typeof globalThis !== 'undefined' && !globalThis.sendUserMessage) {
  globalThis.sendUserMessage = sendUserMessage;
}
