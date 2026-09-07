import { afterEach, describe, expect, test } from 'bun:test';
import type { ChatChunk, Session } from '../../shared/types';
import { WorkspaceStore } from './store';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const session = (id: string): Session => ({ id, harness: 'claude-code', cwd: '/workspace', title: id, messages: [], suggestions: [], createdAt: 1, updatedAt: 1, status: 'idle' });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('persistent session chat connections', () => {
  test('metadata leaves chat idle and stale frames cannot overwrite a newly started turn', async () => {
    const first = session('first');
    const metadata: { controller: ReadableStreamDefaultController<Uint8Array>; signal?: AbortSignal | null }[] = [];
    let turn!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/harnesses') return Response.json([]);
      if (path === '/api/sessions') return Response.json([first]);
      if (path.endsWith('/artifacts')) return Response.json([]);
      if (path.endsWith('/metadata')) return new Response(new ReadableStream({ start(controller) { metadata.push({ controller, signal: init?.signal }); } }), { headers: { 'content-type': 'text/event-stream' } });
      if (path === '/api/chat') return new Response(new ReadableStream({ start(controller) { turn = controller; } }), { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } });
      return Response.json(first);
    }) as typeof fetch;
    const store = new WorkspaceStore();
    await store.initialize();
    metadata[0].controller.enqueue(encoder.encode('data: {"title":"Named","suggestions":["Next"]}\n\n'));
    await tick();
    expect(store.chat('first')?.status).toBe('ready');
    expect(store.active()?.title).toBe('Named');
    expect(store.active()?.suggestions).toEqual(['Next']);
    store.send('first', 'New turn');
    await tick();
    expect(metadata[0].signal?.aborted).toBe(true);
    metadata[0].controller.enqueue(encoder.encode('data: {"title":"Stale title","suggestions":["Old"]}\n\n'));
    metadata[0].controller.close();
    await tick();
    expect(store.active()?.title).toBe('Named');
    expect(store.active()?.suggestions).toEqual([]);
    turn.enqueue(encoder.encode('data: {"type":"start","messageId":"new"}\n\ndata: {"type":"finish"}\n\n'));
    turn.close();
    await tick();
    for (const entry of metadata.slice(1)) entry.controller.close();
  });

  test('switching sessions keeps consuming the first stream and routes data to its owning session', async () => {
    const first = session('first');
    const second = session('second');
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let streamSignal: AbortSignal | null | undefined;
    const encode = (chunk: ChatChunk) => new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/harnesses') return Response.json([]);
      if (path === '/api/sessions') return Response.json([first, second]);
      if (path.endsWith('/artifacts')) return Response.json([]);
      if (path === '/api/chat') { streamSignal = init?.signal; return new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } }); }
      return Response.json(path.endsWith('/first') ? first : second);
    }) as typeof fetch;
    const store = new WorkspaceStore();
    await store.initialize();
    const originalChat = store.chat('first');
    store.send('first', 'Build a card');
    await tick();
    controller.enqueue(encode({ type: 'start', messageId: 'answer' }));
    controller.enqueue(encode({ type: 'text-start', id: 'text' }));
    controller.enqueue(encode({ type: 'text-delta', id: 'text', delta: 'before ' }));
    await tick();
    await store.select('second');
    expect(streamSignal?.aborted).toBe(false);
    controller.enqueue(encode({ type: 'text-delta', id: 'text', delta: 'after' }));
    controller.enqueue(encode({ type: 'data-artifact', id: 'file', data: { path: '.ui4a/test.tsx', source: 'export default () => <p>ok</p>', revision: 1, streaming: false } }));
    controller.enqueue(encode({ type: 'data-recap', id: 'recap', data: { title: 'First title', suggestions: ['Change it'] } }));
    controller.enqueue(encode({ type: 'text-end', id: 'text' }));
    controller.enqueue(encode({ type: 'finish' }));
    controller.close();
    await tick();
    expect(store.getSnapshot().activeId).toBe('second');
    expect(store.artifacts('second')).toHaveLength(0);
    expect(store.artifacts('first')).toHaveLength(1);
    await store.select('first');
    expect(store.chat('first')).toBe(originalChat);
    expect(originalChat?.messages.at(-1)?.parts.find(part => part.type === 'text')).toEqual({ type: 'text', text: 'before after', state: 'done' });
  });
});
