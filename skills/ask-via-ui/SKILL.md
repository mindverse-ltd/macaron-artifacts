---
name: ask-via-ui
description: "Whenever you would ask the user a question — pick between options, confirm a plan, fill in fields, disambiguate a target, adjust a value — render an interactive card via `mcp__macaron.render_ui` and collect the answer through `sendUserMessage`. The built-in `AskUserQuestion` tool is DISABLED in this environment; text-only 'reply with your choice' prompts are also NOT allowed. Every question the user has to answer must be a clickable widget."
---

# Ask via UI (never as plain text)

`AskUserQuestion` is disabled here. Text prompts like "which one?", "reply 1/2/3", "should I do X or Y?" are equally forbidden — a plain-text question forces the user to type a reply, when a widget could resolve it in one click and carry richer context (form values, adjusted sliders, selected chips) back to the next turn.

**Rule**: If your turn would end with the user needing to answer, that answer must arrive via a widget you rendered.

## When this fires (non-exhaustive)

- **Commit / push gate**: "want me to commit this?", "should I push?", "open a PR?" — the end-of-work hand-off. Two buttons, and optionally a default with a countdown (template C).
- **Choice**: "Pick a framework", "which of these files did you mean", "A or B?", boolean confirms.
- **Form**: any request for structured input — name/email/config values, migration parameters, tuning knobs.
- **Adjustment**: pick a color, resize a padding, choose a threshold. Slider / color picker / preview + apply beats "give me a number".
- **Disambiguation**: 3 matching functions, 2 possible interpretations, several branches you could take.
- **Confirmation before a destructive action**: "apply this migration?" → render the diff summary + Apply / Cancel buttons.
- **Sequential wizard**: multi-step configuration — render one step at a time, each step's Continue button posts the state.

## The pattern

Every widget you render for an answer must:
1. Show the question clearly at the top (one sentence).
2. Present the answer surface using the six `$ui4a/ui` components: `Button`, `Field`, `Card`, `Badge`, `Tabs`, and `Disclosure`. Compose layouts with native HTML and UnoCSS Wind4 utilities; use native inputs or `@headlessui/react` for other controls. `$macaron/ui` is only a compatibility alias for these same six components.
3. On submit / click, call `sendUserMessage(...)` with a natural-language sentence that includes every value the next turn needs. Fold structured data (JSON fenced block) into that string when the fields don't compress into prose.
4. End your assistant text after render with a one-sentence ack ("Pick one above.", "Fill out the form."). Do NOT restate the options in prose.

## Templates

### A. Choice picker (2–5 options)

```tsx
import { Card, Button } from '$ui4a/ui';
import { sendUserMessage } from '$macaron/chat';

const options = [
  { id: 'a', label: 'Option A', hint: 'why this one', reply: 'Go with option A' },
  { id: 'b', label: 'Option B', hint: 'why this one', reply: 'Go with option B' },
];

export default function App() {
  return (
    <Card className="max-w-md">
      <h2 className="text-lg font-semibold">Pick one</h2>
      <p className="mt-1 text-sm text-muted">The decision, in one sentence.</p>
      <div className="mt-4 flex flex-col gap-2">
        {options.map((o) => (
          <Button key={o.id} variant="secondary" className="justify-start h-auto py-3 text-left" onClick={() => sendUserMessage(o.reply)}>
            <span className="flex flex-col items-start gap-0.5">
              <span className="font-medium">{o.label}</span>
              <span className="text-xs opacity-70">{o.hint}</span>
            </span>
          </Button>
        ))}
      </div>
    </Card>
  );
}
```

### B. Form (structured input)

```tsx
import { useState } from 'react';
import { Card, Field, Button } from '$ui4a/ui';
import { sendUserMessage } from '$macaron/chat';

export default function App() {
  const [name, setName] = useState('');
  const [port, setPort] = useState('3000');
  const [ssl, setSsl] = useState(true);

  const submit = () => {
    const payload = { name, port: Number(port), ssl };
    sendUserMessage(
      `Configure with: ${name} on :${port} (ssl=${ssl}).\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
    );
  };

  return (
    <Card className="max-w-md">
      <h2 className="text-lg font-semibold">Configuration</h2>
      <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Field label="Service name" value={name} onChange={(event) => setName(event.target.value)} placeholder="my-api" required />
        <Field label="Port" type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} required />
        <label className="flex items-center gap-2"><input type="checkbox" checked={ssl} onChange={(event) => setSsl(event.target.checked)} />Enable SSL</label>
        <Button type="submit" disabled={!name}>Apply</Button>
      </form>
    </Card>
  );
}
```

### C. Commit gate (with a default + countdown)

The most common question a coding agent asks — "want me to commit this?" — is also the one most often typed as prose. It is two buttons.

Add the countdown ONLY when the session gives you evidence the user wants the default to just happen: they said "just commit" / "don't ask me", or they've approved the same thing several times already. No evidence → same card, drop the `useAutoSend` line and the `(Ns)` suffix.

```tsx
import { Card, Button } from '$ui4a/ui';
import { sendUserMessage, useAutoSend } from '$macaron/chat';

const COMMIT = 'Commit it.';
const SKIP = "Don't commit — leave the changes in the working tree.";

export default function App() {
  // Counts down and sends COMMIT if the user does nothing; `left` is the seconds
  // remaining, or null when nothing is counting (e.g. a re-opened transcript —
  // the host refuses to arm there, so the buttons stay but the timer doesn't).
  const left = useAutoSend(COMMIT, 30);

  return (
    <Card className="max-w-md">
      <h2 className="text-lg font-semibold">Commit these changes?</h2>
      <p className="mt-1 text-sm text-muted">3 files, +82 −14 — <code>feat: add retry to the upload queue</code></p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {left !== null && <span className="text-xs text-muted mr-auto">Committing automatically in {left}s</span>}
        <Button variant="ghost" onClick={() => sendUserMessage(SKIP)}>Don't commit</Button>
        <Button onClick={() => sendUserMessage(COMMIT)}>Commit{left !== null ? ` (${left}s)` : ''}</Button>
      </div>
    </Card>
  );
}
```

Show the file/diff summary in the card — the user is approving a specific change, and a bare "Commit?" makes the button meaningless. Same shape for push / open-a-PR / apply-migration gates.

### D. Confirm before destructive

```tsx
import { Card, Button } from '$ui4a/ui';
import { sendUserMessage } from '$macaron/chat';

export default function App() {
  return (
    <Card className="max-w-md">
      <h2 className="text-lg font-semibold">Delete 12 files?</h2>
      <p className="mt-1 text-sm text-muted">This can't be undone.</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => sendUserMessage("Cancel, don't delete anything.")}>Cancel</Button>
        <Button variant="danger" onClick={() => sendUserMessage('Yes, delete the 12 files.')}>Delete 12 files</Button>
      </div>
    </Card>
  );
}
```

## Common failure modes to avoid

- Writing "Which one? 1. A  2. B  3. C" then waiting. — Fail. Render buttons.
- Rendering the widget AND ALSO listing the options in prose. — Redundant; the card is the answer surface.
- Making buttons that just log or alert instead of calling `sendUserMessage`. — The next turn never sees the click.
- Forgetting to import `sendUserMessage` (`import { sendUserMessage } from '$macaron/chat';`). Bare call also works via `globalThis.sendUserMessage`, but the import is the documented path.
- Emitting a widget without a `reply` payload string on each option — the next turn can't tell what was chosen.
- Arming a countdown the user never asked for, or one whose remaining seconds aren't visible on the button. Both turn "convenient" into "it committed behind my back".
- Passing a different string to `useAutoSend` than to the default button's `sendUserMessage` — clicking early then does something other than what the label promised.
- Rolling your own `setTimeout` inside the widget instead of `useAutoSend` — a widget-local timer re-fires every time the transcript is re-opened.
