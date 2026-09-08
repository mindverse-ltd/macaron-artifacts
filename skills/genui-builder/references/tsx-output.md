# GenUI TSX Output

Read this reference when authoring or repairing `App.tsx` for GenUI.

## Streaming Runtime Requirements

- Default every model-backed GenUI UI to streaming.
- Request chat completions with `stream: true`.
- Parse Server-Sent Events incrementally; do not wait for `response.text()`.
- Update the code pane on every content delta.
- Render during the stream:
  - Prefer `partial-react` `GenUIRenderer.pushCode(delta)` and `finish(finalCode)`.
  - If that runtime is unavailable, run `partial-tsx` `normalizeGeneratedTsx(partialCode)` before compiling renderable snapshots.
- Preserve the last good visual frame when the current partial TSX fails.
- Finalize with a complete render when `[DONE]` arrives.
- If using a local proxy, stream upstream chunks directly to the browser. Do not buffer the upstream body first.

## Module Shape

- Create one complete TSX module.
- Export `default function App()`.
- Keep all helper components, arrays, and utilities in the same file.
- Do not call `ReactDOM.createRoot`.
- Do not import from relative files, guessed sibling modules, or server-only packages.
- Import each module once.

Preferred base import:

```tsx
import { Button, Field, Card, Badge, Tabs, Disclosure } from '$ui4a/ui';
```

This is the complete component set. `$macaron/ui` is only a compatibility alias for these six exports. Layout, headings, descriptions, tables, and metrics use native HTML with UnoCSS Wind4 classes.

| Component | Props |
| --- | --- |
| `Button` | Native button props; `variant`: `primary` (default), `secondary`, `ghost`, or `danger`; `size`: `sm` or `md` (default). Defaults to `type="button"`; forms need `type="submit"`. |
| `Field` | Native input props plus required `label` and optional `hint`; provides a linked label and hint. `className` styles the input. |
| `Card` | Native div props and children; compose its contents with HTML. |
| `Badge` | Native span props and children. |
| `Tabs` | `items: { id, label, children }[]`, optional `value` and `onChange(id)`; powered by Headless UI. |
| `Disclosure` | `title`, `children`, and optional `defaultOpen`; powered by Headless UI. |

For additional accessible controls, import directly from `@headlessui/react`, such as `Switch`, `Dialog`, or `Listbox`. Native inputs, checkboxes, ranges, selects, and textareas are also available.

For charts, import directly from Recharts:

```tsx
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const data = [{ month: 'Jan', value: 32 }, { month: 'Feb', value: 48 }, { month: 'Mar', value: 41 }];

export default function App() {
  return <div className="h-44 min-h-44 w-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="month" stroke="var(--muted)" /><YAxis stroke="var(--muted)" />
        <Tooltip contentStyle={{ background: 'var(--surface)', color: 'var(--fg)', borderColor: 'var(--border)' }} />
        <Area dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
```

In the retained `render_ui` host, send answers through `import { sendUserMessage, useAutoSend } from '$macaron/chat'`. File and persistent-state APIs belong to the unified app's generated skill; do not invent equivalent legacy modules.

## Surface Selection

- Use `hero` for one focused object: card, invitation, timer, single chart, profile, coupon.
- Use `bento` for 3-5 peer widgets: metric boards, settings groups, menus, itinerary summaries.
- Use `compose` for editorial reading flow: recipes, timelines, comparisons, pricing, receipts.
- Use `flow` only when the user explicitly asks for an app, website, dashboard, builder, landing page, or product flow.

## Interaction

- Every button/control must do something visible: change state, reveal detail, navigate to a provided URL, copy/export text, or submit local form state.
- Use functional `setState` when next state depends on previous state.
- Avoid derived state effects; derive display values during render.
- For audio, create/resume `AudioContext` only inside a user gesture handler.

## Layout And Styling

- Use UnoCSS `presetWind4` classes and semantic colors (`bg-surface`, `text-fg`, `text-muted`, `border-border`, `bg-accent`); the selected Shiki palette supplies their values. Avoid `<style>` tags unless unavoidable.
- Put `@container` on the preview root or a wrapper, and use `@sm/@md/@lg` only on descendants.
- Avoid full-page shells, fixed/sticky chrome, nav bars, heavy footers, and full-viewport hero layouts.
- Do not nest cards inside cards.
- Cap grids at 3 columns at every breakpoint.
- Keep text inside its container across mobile and desktop widths.
- Use a restrained palette with multiple muted hue families; avoid default purple-blue gradients and decorative glows.

## Validation Fixes

- Missing Bun/Bunx: report the missing prerequisite and provide the unvalidated files.
- Only final render updates: add `stream: true`, SSE parsing, partial TSX completion, and preview refresh inside the chunk loop.
- Proxy not streaming: remove `await upstream.text()` / `arrayBuffer()` from the proxy path and pipe upstream chunks to the response.
- Import error: check the host's module contract and exact exports. External CLI validation has a separate import registry; it does not establish compatibility with host capabilities.
- Type error on component props: use documented local component props; do not force with `as any` or `as never`.
- Chart blank/zero height: place Recharts `ResponsiveContainer` inside an element with a stable height such as `className="h-44 min-h-44 w-full"`.
- Key warnings: add `id` or `slug` to data and use that value as `key`.
- SSR failure from browser APIs: move `window`, `document`, `AudioContext`, timers, and storage access into event handlers or guarded effects.
