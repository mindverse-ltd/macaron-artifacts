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
  assert.deepEqual(await checkGenUI(validModule('interactive')), { ok: true });
});

test('accepts Wind4-only utilities and migrated legacy component classes', async () => {
  assert.deepEqual(await checkGenUI(validModule('inset-shadow-sm text-shadow-sm rounded-xs shadow-xs outline-hidden field-sizing-content')), { ok: true });
});

test('server Wind4 generation uses the shared semantic theme without a page reset', async () => {
  const { generator } = await loadGenUIUnocssToolkit();
  const result = await generator.generate('bg-surface text-fg border-border text-accent-fg bg-series-1 interactive rounded-lg shadow-xs ring-2 animate-in');
  for (const token of ['surface', 'fg', 'border', 'accent-fg', 'series-1']) assert.ok(result.css.includes(`var(--${token})`));
  assert.match(result.css, /\.ui4a-surface/);
  assert.match(result.css, /@property --un-ring-shadow/);
  assert.match(result.css, /@keyframes una-in/);
  assert.match(result.css, /transition-property:\s*color,background-color,border-color,opacity,transform/);
  assert.doesNotMatch(result.css, /--macaron-/);
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

for (const module of ['$ui4a/ui', '$macaron/ui']) test(`${module} exposes the same six typed components`, async () => {
  const result = await checkGenUI(`import { Button, Field, Card, Badge, Tabs, Disclosure } from '${module}';
export default function App() { return <Card><Button variant="secondary" size="sm">Save</Button><Field label="Name" hint="Required" /><Badge>Ready</Badge><Tabs items={[{id:'one', label:'One', children:'Content'}]} value="one" onChange={id => id.toUpperCase()} /><Disclosure title="Details" defaultOpen>Info</Disclosure></Card>; }`);
  assert.deepEqual(result, { ok: true });
});

test('keeps host semantic diagnostics for invalid component props', async () => {
  const badProp = await checkGenUI(
    `import { Button } from '$ui4a/ui';\nexport default function App() { return <Button bogus="value">Hello</Button>; }`,
  );
  assert.equal(badProp.ok, false);
  assert.match(badProp.diagnostics ?? '', /\[typescript\]/);
  assert.match(badProp.diagnostics ?? '', /Property 'bogus' does not exist/);
});

for (const module of ['$ui4a/ui', '$macaron/ui']) test(`${module} rejects removed component exports`, async () => {
  for (const name of ['CardHeader', 'Stat', 'StatGrid', 'Text', 'MissingComponent']) {
    const result = await checkGenUI(`import { ${name} } from '${module}';\nexport default function App() { return <${name} />; }`);
    assert.equal(result.ok, false);
    assert.match(result.diagnostics ?? '', new RegExp(`has no exported member '${name}'`));
  }
});

test('rejects removed facade submodules and unavailable state or filesystem APIs', async () => {
  for (const module of ['$macaron/ui/charts', '$ui4a/state', '$ui4a/fs']) {
    const result = await checkGenUI(`import * as api from '${module}';\nexport default function App() { return <div>{Object.keys(api).length}</div>; }`);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics?.includes(`Cannot find module '${module}'`), result.diagnostics);
  }
});

test('accepts direct Headless UI, Recharts and Lucide imports', async () => {
  const result = await checkGenUI(`import { Switch } from '@headlessui/react';
import { BarChart, Bar } from 'recharts';
import { Check } from 'lucide-react';
export default function App() { return <div><Switch checked={true} onChange={() => {}}><Check /></Switch><BarChart width={200} height={100} data={[{name:'A', value:1}]}><Bar dataKey="value" /></BarChart></div>; }`);
  assert.deepEqual(result, { ok: true });
});

test('render_ui returns the shared lint diagnostics to the model', async () => {
  const result = await handleRenderUI(validModule('not-a-real-uno-class'));

  assert.equal(result.ok, false);
  assert.match(result.text, /^Rendered inline, but the TSX has issues:/);
  assert.match(result.text, /\[unocss\]/);
  assert.match(result.text, /Unknown UnoCSS class `not-a-real-uno-class`/);
});
