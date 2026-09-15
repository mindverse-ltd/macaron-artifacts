import { afterEach, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { ApprovalCard } from './ApprovalCard';

const originalMatchMedia = globalThis.matchMedia;
afterEach(() => { globalThis.matchMedia = originalMatchMedia; });
const approval = { id: 'approval-1', tool: 'Read', input: { path: 'README.md' } };

test('pending approval exposes stable actions without waiting for syntax highlighting', () => {
  globalThis.matchMedia = query => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
  const html = renderToStaticMarkup(<ThemeProvider><ApprovalCard approval={approval} onDecide={async () => {}} /></ThemeProvider>);
  expect(html).toContain('data-approval-id="approval-1"');
  expect(html).toContain('data-approval-decision="allow"'); expect(html).toContain('data-approval-decision="deny"');
  expect(html).toContain('aria-label="操作确认"'); expect(html).toContain('README.md');
});

test('restored resolved approval renders only the status instead of replaying its entrance', () => {
  const html = renderToStaticMarkup(<ApprovalCard approval={{ ...approval, resolved: true }} onDecide={async () => {}} />);
  expect(html).toContain('role="status"'); expect(html).toContain('已处理');
  expect(html).not.toContain('data-approval-decision'); expect(html).not.toContain('approval-presence'); expect(html).not.toContain('data-enter');
});
