import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactObserver, writeUi4aFile } from './artifacts';
import type { ChatChunk } from '../shared/types';

const cleanups: (() => Promise<void>)[] = [], path = '.artifacts/canvases/research.ui4a.tsx';
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(source?: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'artifact-stream-')), chunks: ChatChunk[] = [], observer = new ArtifactObserver(cwd, chunk => chunks.push(chunk));
  cleanups.push(async () => { await observer.close(); await rm(cwd, { recursive: true, force: true }); });
  if (source !== undefined) await writeUi4aFile(cwd, path, source);
  await observer.refresh();
  const start = (name = 'Write', id = 'write') => observer.accept({ type: 'tool-input-start', toolCallId: id, toolName: name });
  const delta = (text: string, id = 'write') => observer.accept({ type: 'tool-input-delta', toolCallId: id, inputTextDelta: text });
  const frames = () => chunks.filter(chunk => chunk.type === 'data-artifact').map(chunk => chunk.data);
  return { cwd, observer, chunks, start, delta, frames };
}

test('native Write prefixes survive unrelated scans and settle once from the real file', async () => {
  const { cwd, observer, start, delta, frames } = await fixture('old');
  start(); delta(`{"file_path":"${path}","content":"export default () => <main>`);
  expect(frames().at(-1)).toMatchObject({ source: 'export default () => <main>', streaming: true, toolCallId: 'write' });
  const count = frames().length; await observer.refresh(); expect(frames()).toHaveLength(count);
  delta('Findings</main>"}'); const source = frames().at(-1)!.source;
  await writeUi4aFile(cwd, path, source); await observer.refresh(); expect(frames().at(-1)?.streaming).toBe(true);
  observer.accept({ type: 'tool-output-available', toolCallId: 'write', output: 'ok' }); await observer.refresh();
  expect(frames().at(-1)).toMatchObject({ source, streaming: false });
  const settled = frames().length; await observer.finish(); expect(frames()).toHaveLength(settled);
});

test('incomplete paths are not previewed, including content-first native arguments', async () => {
  const { observer, start, delta, frames } = await fixture();
  start(); delta(`{"content":"export default () => null","file_path":"${path}`); expect(frames()).toHaveLength(0);
  delta('"}'); expect(frames().at(-1)?.streaming).toBe(true);
  await observer.finish(); expect(frames().at(-1)).toMatchObject({ path, streaming: false, deleted: true });
});

test('Edit reconstructs every prefix from the unchanged base and retains the module suffix', async () => {
  const { observer, start, delta, frames } = await fixture('export default () => <p>Outline</p>');
  start('Edit', 'edit'); delta(`{"file_path":"${path}","old_string":"Outline","new_string":"Evidence`, 'edit');
  expect(frames().at(-1)?.source).toBe('export default () => <p>Evidence</p>');
  delta(' and sources"}', 'edit'); expect(frames().at(-1)?.source).toBe('export default () => <p>Evidence and sources</p>');
  observer.accept({ type: 'tool-output-error', toolCallId: 'edit', errorText: 'Rejected' }); await observer.refresh();
  expect(frames().at(-1)).toMatchObject({ source: 'export default () => <p>Outline</p>', streaming: false });
});

test('partial or ambiguous old_string never edits the wrong part of a module', async () => {
  const { observer, start, delta, frames } = await fixture('export default () => <p>aa aa</p>');
  start('Edit'); delta(`{"file_path":"${path}","new_string":"b","old_string":"aa`); expect(frames()).toHaveLength(1);
  delta('"'); expect(frames()).toHaveLength(1);
  delta(',"replace_all":true}'); expect(frames().at(-1)?.source).toBe('export default () => <p>b b</p>');
  await observer.finish(); expect(frames().at(-1)?.streaming).toBe(false);
});

test('Edit drafts retain raw splice bytes and strict parsing when another preview is rejected', async () => {
  const { observer, start, delta, frames } = await fixture('export default () => <main>Outline<Card>Kept</Card></main>');
  start('Edit', 'edit'); delta(`{"file_path":"${path}","old_string":"Outline","new_string":"<`, 'edit');
  expect(frames().at(-1)).toMatchObject({ source: 'export default () => <main><<Card>Kept</Card></main>', streaming: true, partial: false });
  observer.accept({ type: 'tool-input-available', toolCallId: 'other', toolName: 'Write', input: { file_path: path, content: 'export default () => <p>Other' } });
  expect(frames().at(-1)?.partial).toBeUndefined();
  await observer.accept({ type: 'tool-output-denied', toolCallId: 'other' });
  expect(frames().at(-1)).toMatchObject({ toolCallId: 'edit', partial: false });
  delta('h2>Evidence</h2>"}', 'edit');
  expect(frames().at(-1)).toMatchObject({ source: 'export default () => <main><h2>Evidence</h2><Card>Kept</Card></main>', partial: false });
  await observer.accept({ type: 'tool-output-error', toolCallId: 'edit', errorText: 'Rejected' });
  expect(frames().at(-1)?.partial).toBeUndefined();
});

test('complete-only tool inputs produce one pending snapshot without invented deltas', async () => {
  const { observer, frames } = await fixture();
  observer.accept({ type: 'tool-input-available', toolCallId: 'complete', toolName: 'Write', input: { file_path: path, content: 'export default () => null' } });
  expect(frames()).toHaveLength(1);
  observer.accept({ type: 'tool-output-denied', toolCallId: 'complete' }); await observer.refresh();
  expect(frames().at(-1)?.deleted).toBe(true);
  observer.accept({ type: 'tool-input-available', toolCallId: 'patch', toolName: 'apply_patch', input: { changes: [] } });
  expect(frames()).toHaveLength(2);
});


test('rejecting a concurrent Write restores the latest remaining preview for that path', async () => {
  const { observer, frames } = await fixture('disk');
  const preview = (id: string, content: string) => observer.accept({ type: 'tool-input-available', toolCallId: id, toolName: 'Write', input: { file_path: path, content } });
  preview('A', 'first A'); preview('B', 'B'); preview('A', 'latest A');
  await observer.accept({ type: 'tool-output-error', toolCallId: 'A', errorText: 'Rejected' });
  expect(frames().at(-1)).toMatchObject({ source: 'B', streaming: true, toolCallId: 'B' });
  await observer.accept({ type: 'tool-output-denied', toolCallId: 'B' });
  expect(frames().at(-1)).toMatchObject({ source: 'disk', streaming: false });
});

test('finish rejects late input while its final disk scan is pending', async () => {
  const { observer, frames } = await fixture('disk');
  const finishing = observer.finish();
  observer.accept({ type: 'tool-input-available', toolCallId: 'late', toolName: 'Write', input: { file_path: path, content: 'late' } });
  await finishing;
  expect(frames().at(-1)).toMatchObject({ source: 'disk', streaming: false });
});

test('awaiting a tool result refreshes the base before the next Edit', async () => {
  const { cwd, observer, frames } = await fixture('export default () => <p>A B</p>');
  observer.accept({ type: 'tool-input-available', toolCallId: 'first', toolName: 'Edit', input: { file_path: path, old_string: 'A', new_string: 'AA' } });
  await writeUi4aFile(cwd, path, 'export default () => <p>AA B</p>');
  await observer.accept({ type: 'tool-output-available', toolCallId: 'first', output: 'ok' });
  observer.accept({ type: 'tool-input-available', toolCallId: 'second', toolName: 'Edit', input: { file_path: path, old_string: 'B', new_string: 'BB' } });
  expect(frames().at(-1)).toMatchObject({ source: 'export default () => <p>AA BB</p>', streaming: true });
});
