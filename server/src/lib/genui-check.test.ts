import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGenUI } from './genui-check.js';
import { handleRenderUI } from './macaron-render-tool.js';
import { loadGenUIUnocssToolkit } from './genui-unocss.js';

const validModule = (className = 'p-4 text-sm') =>
  `export default function App() { return <div className="${className}">Hello</div>; }`;

test('accepts valid TSX', async () => {
  assert.deepEqual(await checkGenUI(validModule()), { ok: true });
});

test('rejects unknown UnoCSS classes with their source location', async () => {
  const result = await checkGenUI(validModule('not-a-real-uno-class'));

  assert.equal(result.ok, false);
  assert.match(result.diagnostics ?? '', /\[unocss\]/);
  assert.match(result.diagnostics ?? '', /Unknown UnoCSS class `not-a-real-uno-class` \(line 1:/);
});

test('accepts host UnoCSS shortcuts', async () => {
  assert.deepEqual(await checkGenUI(validModule('bg-macaron-gradient')), { ok: true });
});

test('accepts Wind4-only utilities and migrated legacy component classes', async () => {
  assert.deepEqual(await checkGenUI(validModule('inset-shadow-sm text-shadow-sm rounded-xs shadow-xs outline-hidden field-sizing-content')), { ok: true });
});

test('server Wind4 generation retains theme and property preflights without a page reset', async () => {
  const { generator } = await loadGenUIUnocssToolkit();
  const result = await generator.generate('bg-background text-primary-foreground rounded-lg shadow-xs ring-2 animate-accordion-down');
  assert.match(result.css, /--macaron-background/);
  assert.match(result.css, /--radius-lg: var\(--macaron-radius\)/);
  assert.match(result.css, /@property --un-ring-shadow/);
  assert.match(result.css, /@keyframes accordion-down/);
  assert.doesNotMatch(result.css, /box-sizing: border-box/);
});

test('rejects UnoCSS utilities assembled across template interpolation', async () => {
  const result = await checkGenUI(
    "export default function App() { const color = 'red'; return <div className={`bg-${color}-500`}>Hello</div>; }",
  );

  assert.equal(result.ok, false);
  assert.match(result.diagnostics ?? '', /\[unocss\]/);
  assert.match(result.diagnostics ?? '', /Dynamic UnoCSS class `bg-\$\{color\}-500` cannot be extracted/);
});

test('reports strict syntax diagnostics instead of compiler recovery', async () => {
  const result = await checkGenUI(`export default function App() {\n  const p = 'Type what you're feeling right now';\n  return <div>ok</div>;\n}`);

  assert.equal(result.ok, false);
  assert.match(result.diagnostics ?? '', /\[runtime\]/);
  assert.match(result.diagnostics ?? '', /unescaped '/);
  assert.match(result.diagnostics ?? '', /\(line 2:27\)/);
});

test('preserves leading source lines in shared syntax diagnostics', async () => {
  const result = await checkGenUI(`\n\nexport default function App() {\n  const p = 'Type what you're feeling right now';\n  return <div>ok</div>;\n}`);

  assert.equal(result.ok, false);
  assert.match(result.diagnostics ?? '', /unescaped '/);
  assert.match(result.diagnostics ?? '', /\(line 4:27\)/);
});

test('keeps host semantic diagnostics for invalid facade usage', async () => {
  const badProp = await checkGenUI(
    `import { Text } from '$macaron/ui';\nexport default function App() { return <Text bogus="value">Hello</Text>; }`,
  );
  const badExport = await checkGenUI(
    `import { MissingComponent } from '$macaron/ui';\nexport default function App() { return <MissingComponent />; }`,
  );

  assert.equal(badProp.ok, false);
  assert.match(badProp.diagnostics ?? '', /\[typescript\]/);
  assert.match(badProp.diagnostics ?? '', /Property 'bogus' does not exist/);
  assert.equal(badExport.ok, false);
  assert.match(badExport.diagnostics ?? '', /has no exported member 'MissingComponent'/);
});

test('render_ui returns the shared lint diagnostics to the model', async () => {
  const result = await handleRenderUI(validModule('not-a-real-uno-class'));

  assert.equal(result.ok, false);
  assert.match(result.text, /^Rendered inline, but the TSX has issues:/);
  assert.match(result.text, /\[unocss\]/);
  assert.match(result.text, /Unknown UnoCSS class `not-a-real-uno-class`/);
});
