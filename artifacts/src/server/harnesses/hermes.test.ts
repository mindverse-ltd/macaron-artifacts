import { describe, expect, test } from 'bun:test';
import { closeHermesConnections, decodeHermesNativeId, encodeHermesNativeId } from './hermes.js';
import { parseHermesReadyLine, rpcPayload } from './hermes-server.js';

describe('Hermes gateway adapter protocol helpers', () => {
  test('parses only the public serve readiness sentinel', () => {
    expect(parseHermesReadyLine('HERMES_BACKEND_READY port=43123')).toBe('ws://127.0.0.1:43123/api/ws');
    expect(parseHermesReadyLine('Hermes backend listening on 127.0.0.1:43123')).toBeUndefined();
  });

  test('keeps runtime and durable session identity across reconnects', () => {
    const encoded = encodeHermesNativeId({ sessionId: 'runtime-1', storedId: '20260909_foo', profile: 'coding' });
    expect(decodeHermesNativeId(encoded)).toEqual({ sessionId: 'runtime-1', storedId: '20260909_foo', profile: 'coding' });
    expect(decodeHermesNativeId('legacy-session')).toEqual({ sessionId: 'legacy-session' });
  });

  test('unwraps JSON-RPC result envelopes without exposing unrelated fields', () => {
    expect(rpcPayload({ result: { session_id: 'runtime-1' }, id: 1 })).toEqual({ session_id: 'runtime-1' });
    expect(rpcPayload({ session_id: 'runtime-1' })).toEqual({ session_id: 'runtime-1' });
  });

  test('resumes the durable session and maps Hermes thinking deltas', async () => {
    const OriginalWebSocket = globalThis.WebSocket;
    let runtime = 0;
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      private listeners = new Map<string, Set<(event: { data?: string }) => void>>();
      constructor() { queueMicrotask(() => this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } }) })); }
      addEventListener(type: string, listener: (event: { data?: string }) => void) { let listeners = this.listeners.get(type); if (!listeners) this.listeners.set(type, listeners = new Set()); listeners.add(listener); }
      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> }, reply = (result: Record<string, unknown>) => this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
        if (request.method === 'session.create') { runtime = 1; reply({ session_id: 'runtime-1', stored_session_id: 'stored-1' }); }
        else if (request.method === 'session.resume') { runtime = 2; reply({ session_id: 'runtime-2', stored_session_id: 'stored-1' }); }
        else if (request.method === 'prompt.submit') { reply({ status: 'streaming' }); queueMicrotask(() => { const sid = `runtime-${runtime}`; for (const [type, payload] of [['thinking.delta', { text: 'plan' }], ['message.delta', { text: 'answer' }], ['message.complete', { text: 'answer' }]] as const) this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sid, payload } }) }); }); }
        else reply({});
      }
      close() { this.readyState = 3; }
      private emit(type: string, event: { data?: string }) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
    }
    (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket;
    process.env.MACARON_HERMES_URL = 'ws://hermes.test';
    try {
      const { hermesAdapter } = await import('./hermes.js');
      const base = { cwd: '/tmp', instructions: '', signal: new AbortController().signal, approve: async () => true, onNativeSession: (_id: string) => {} };
      let nativeId: string | undefined;
      const run = async (prompt: string) => { const chunks = []; for await (const chunk of hermesAdapter.run({ ...base, prompt, nativeId, onNativeSession: id => { nativeId = id; } })) chunks.push(chunk); return chunks; };
      const first = await run('first'), resumed = await run('second');
      expect(first.filter(chunk => chunk.type === 'reasoning-delta').map(chunk => chunk.delta)).toEqual(['plan']);
      expect(decodeHermesNativeId(nativeId!).sessionId).toBe('runtime-2');
      expect(resumed.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta)).toEqual(['answer']);
    } finally {
      await closeHermesConnections();
      globalThis.WebSocket = OriginalWebSocket;
      delete process.env.MACARON_HERMES_URL;
    }
  });
});
