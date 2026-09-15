import { expect, test } from 'bun:test';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DefaultLegendContent, DefaultTooltipContent, Legend as NativeLegend, Tooltip as NativeTooltip } from 'recharts';
import { Area, Bar, Legend, Line, Pie, Tooltip, XAxis, YAxis } from './charts';

const payload = [{ value: 'Yellow series', name: 'Yellow series', type: 'rect' as const, color: '#d0b42b' }];

test('default legend keeps series markers but renders readable active and inactive labels', () => {
  const props = Legend({}).props;
  for (const inactive of [false, true]) {
    const html = renderToStaticMarkup(<DefaultLegendContent {...props} payload={payload.map(item => ({ ...item, inactive }))} />);
    expect(html).toContain('<span style="color:var(--fg)">Yellow series</span>');
    expect(html).toContain(`fill="${inactive ? '#ccc' : '#d0b42b'}"`);
  }
  expect(Legend({}).props.formatter).toBe(props.formatter);
});

test('legend preserves explicit formatters, content, label styles and React ref props', () => {
  const formatter = () => <strong>Custom label</strong>, content = <div>Custom legend</div>, ref = createRef<unknown>();
  const props = { formatter, content, ref, iconSize: 18, labelStyle: { color: 'rebeccapurple' } }, element = Legend(props);
  expect(element.type).toBe(NativeLegend);
  for (const key of Object.keys(props)) expect(element.props[key]).toBe(props[key as keyof typeof props]);
  expect(Legend({ labelStyle: props.labelStyle }).props.formatter).toBeUndefined();
  const html = renderToStaticMarkup(<DefaultLegendContent {...Legend({ formatter }).props} payload={payload} />);
  expect(html).toContain('<strong>Custom label</strong>');
  expect(html).not.toContain('var(--fg)');
});

test('default tooltip pairs its surface and text rather than inheriting the series color', () => {
  const html = renderToStaticMarkup(<DefaultTooltipContent {...Tooltip({}).props} label="Category" payload={[{ name: 'Yellow series', value: 42, color: '#d0b42b' }]} />);
  expect(html).toContain('background-color:var(--surface)');
  expect(html).toContain('border-color:var(--border)');
  expect(html).toContain('padding-bottom:4px;color:var(--fg)');
  expect(html).not.toContain('color:#d0b42b');
});

test('tooltip preserves explicit content, formatter, style overrides and React ref props', () => {
  const formatter = () => 'Custom value', ref = createRef<unknown>(), contentStyle = { color: 'navy', backgroundColor: 'white' }, itemStyle = { color: 'maroon', paddingTop: 7 };
  const props = { formatter, ref, contentStyle, itemStyle, active: true }, element = Tooltip(props);
  expect(element.type).toBe(NativeTooltip); expect(element.props.formatter).toBe(formatter); expect(element.props.ref).toBe(ref);
  expect(element.props.contentStyle).toMatchObject(contentStyle); expect(element.props.itemStyle).toMatchObject(itemStyle);
  expect(Tooltip({ contentStyle }).props.itemStyle.color).toBe('navy');
  expect(Tooltip({ wrapperStyle: { color: 'navy' } }).props.contentStyle.color).toBe('navy');
  expect(Tooltip({ wrapperStyle: { color: 'red' }, contentStyle }).props.itemStyle.color).toBe('navy');
  const content = <div>Custom tooltip</div>, custom = Tooltip({ content, contentStyle, itemStyle });
  expect(custom.props.content).toBe(content); expect(custom.props.contentStyle).toBe(contentStyle); expect(custom.props.itemStyle).toBe(itemStyle);
});

test('chart primitives retain Recharts child recognition names', () => {
  for (const [name, component] of [['Legend', Legend], ['Tooltip', Tooltip], ['Line', Line], ['Area', Area], ['Bar', Bar], ['Pie', Pie], ['XAxis', XAxis], ['YAxis', YAxis]] as const) expect(component.displayName).toBe(name);
});
