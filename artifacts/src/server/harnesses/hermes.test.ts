import { describe, expect, test } from 'bun:test';
import { readUIMessageStream } from 'ai';
import type { ChatChunk, ChatMessage } from '../../shared/types.js';
import { closeHermesConnections, decodeHermesNativeId, encodeHermesNativeId, hermesAdapter } from './hermes.js';
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

  test.each([
    { selected: 'local-proxy/gpt-test', model: 'gpt-test', provider: 'custom:local-proxy' },
    { selected: 'custom:local-proxy/gpt-test', model: 'gpt-test', provider: 'custom:local-proxy' },
    { selected: 'local-proxy/namespace/new-model', model: 'namespace/new-model', provider: 'custom:local-proxy' },
    { selected: 'custom:Local (localhost:4000)/vendor/model', model: 'vendor/model', provider: 'custom:local-(localhost:4000)' },
    { selected: 'custom:Older Local/vendor/model', model: 'vendor/model', provider: 'custom:older-local' },
    { selected: 'custom:older-local/vendor/model', model: 'vendor/model', provider: 'custom:older-local' },
    { selected: `custom:Local (localhost:4000)/vendor/model \\with'quote"`, model: `vendor/model \\with'quote"`, provider: 'custom:local-(localhost:4000)' },
    { selected: 'openrouter/anthropic/claude-test', model: 'anthropic/claude-test', provider: 'openrouter' },
    { selected: 'anthropic/claude-test', model: 'anthropic/claude-test', provider: undefined },
    { selected: 'unknown/model/path', model: 'unknown/model/path', provider: undefined },
    { selected: 'missing-provider/gpt-test', model: 'missing-provider/gpt-test', provider: undefined },
    { selected: 'gpt-test', model: 'gpt-test', provider: undefined },
    { selected: 'local-proxy/confirmation-required', model: 'confirmation-required', provider: 'custom:local-proxy' },
    { selected: 'local-proxy/model  with-gap', model: 'model  with-gap', provider: 'custom:local-proxy' },
    { selected: 'local-proxy/model --global', model: 'model --global', provider: 'custom:local-proxy' },
    { selected: 'local-proxy/model \u2013session', model: 'model \u2013session', provider: 'custom:local-proxy' },
    { selected: 'local-proxy/model\u0085gap', model: 'model\u0085gap', provider: 'custom:local-proxy' },
  ])('applies $selected through native per-session controls', async ({ selected, model, provider }) => {
    const OriginalWebSocket = globalThis.WebSocket, originalUrl = process.env.MACARON_HERMES_URL;
    const requests: { id: number; method: string; params: Record<string, unknown> }[] = [];
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      private listeners = new Map<string, Set<(event: { data?: string }) => void>>();
      constructor() { queueMicrotask(() => this.emit({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } })); }
      addEventListener(type: string, listener: (event: { data?: string }) => void) { let listeners = this.listeners.get(type); if (!listeners) this.listeners.set(type, listeners = new Set()); listeners.add(listener); }
      send(raw: string) {
        const request = JSON.parse(raw) as typeof requests[number]; requests.push(request);
        if (request.method === 'session.resume' && 'cwd' in request.params) { this.emit({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'invalid params for session.resume: cwd: Extra inputs are not permitted' } }); return; }
        const result = request.method === 'model.options' ? { providers: [
          { slug: 'local-proxy', name: 'Local Proxy', is_user_defined: true, aliases: ['local-proxy', 'custom:local-proxy'], models: ['gpt-test'] },
          { slug: 'custom:Local (localhost:4000)', is_user_defined: true, aliases: ['custom:local-(localhost:4000)'], models: ['vendor/model', `vendor/model \\with'quote"`] },
          { slug: 'custom:Older Local', is_user_defined: true, models: ['vendor/model'] },
          { slug: 'anthropic', models: ['claude-direct'] },
          { slug: 'openrouter', models: ['anthropic/claude-test'] },
          { aliases: ['missing-provider'], models: ['gpt-test'] },
        ] } : request.method === 'config.set' && request.params.key === 'model' ? { confirm_required: String(request.params.value).startsWith('confirmation-required '), confirm_message: 'Confirm the model in Hermes' } : { session_id: request.method === 'session.resume' ? 'resumed' : 'created', stored_session_id: 'stored' };
        this.emit({ jsonrpc: '2.0', id: request.id, result });
        if (request.method === 'prompt.submit') queueMicrotask(() => this.emit({ jsonrpc: '2.0', method: 'event', params: { type: 'message.complete', session_id: request.params.session_id, payload: { text: 'done' } } }));
      }
      close() { this.readyState = 3; }
      private emit(value: Record<string, unknown>) { for (const listener of this.listeners.get('message') ?? []) listener({ data: JSON.stringify(value) }); }
    }
    (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket;
    process.env.MACARON_HERMES_URL = 'ws://hermes-model.test';
    try {
      let nativeId: string | undefined;
      const instructions = 'Render useful inline UI and save persistent UI in the Canvas.';
      const run = async (prompt: string, chosen = selected) => { for await (const _chunk of hermesAdapter.run({ cwd: '/tmp', model: chosen, profile: { config: { effort: 'low' } }, prompt, nativeId, instructions, signal: new AbortController().signal, approve: async () => true, onNativeSession: id => { nativeId = id; } })) {} };
      for (const prompt of ['first', 'second']) await run(prompt);
      const created = requests.find(request => request.method === 'session.create')!;
      expect(created.params.model).toBe(model);
      expect(created.params.provider).toBe(provider);
      expect(created.params.reasoning_effort).toBe('low');
      expect(created.params.source).toBe('macaron-artifacts');
      expect(created.params.cwd).toBe('/tmp');
      expect(created.params.messages).toBeUndefined();
      expect(requests.filter(request => request.method === 'session.create')).toHaveLength(1);
      expect(requests.some(request => request.method === 'model.options')).toBe(selected.includes('/'));
      for (const request of requests.filter(request => request.method === 'model.options')) expect(request.params).toEqual({ explicit_only: true });
      expect(requests.filter(request => request.method === 'config.set' && request.params.key === 'model')).toHaveLength(0);
      expect(requests.filter(request => request.method === 'session.resume').map(request => request.params)).toEqual([{ session_id: 'stored', source: 'macaron-artifacts', omit_messages: true }]);
      expect(requests.filter(request => request.method === 'prompt.submit').map(request => request.params.text)).toEqual(['first', 'second'].map(prompt => `Host rendering context for this session:\n\n${instructions}\n\nCurrent user request:\n\n${prompt}`));
      expect(requests.filter(request => request.method === 'config.set' && request.params.key === 'reasoning').map(request => request.params)).toEqual([{ session_id: 'resumed', key: 'reasoning', value: 'low', scope: 'session' }]);
      if (model === 'confirmation-required') {
        await run('different model', 'local-proxy/gpt-test');
        for (const prompt of ['switch back', 'retry']) await expect(run(prompt)).rejects.toThrow('Confirm the model in Hermes');
        expect(requests.filter(request => request.method === 'prompt.submit')).toHaveLength(3);
        expect(decodeHermesNativeId(nativeId!).selection).toEqual({ model: 'gpt-test', provider: 'custom:local-proxy' });
        return;
      }
      nativeId = encodeHermesNativeId({ ...decodeHermesNativeId(nativeId!), selection: undefined });
      if (['model  with-gap', 'model --global', 'model \u2013session', 'model\u0085gap'].includes(model)) {
        await expect(run('legacy resume')).rejects.toThrow('cannot safely switch');
        expect(requests.filter(request => request.method === 'config.set' && request.params.key === 'model')).toHaveLength(0);
        expect(requests.filter(request => request.method === 'prompt.submit')).toHaveLength(2);
        return;
      }
      await run('legacy resume');
      expect(requests.filter(request => request.method === 'config.set' && request.params.key === 'model').map(request => request.params)).toEqual([{ session_id: 'resumed', key: 'model', value: `${model}${provider ? ` --provider ${provider}` : ''} --session` }]);
    } finally {
      await closeHermesConnections(); globalThis.WebSocket = OriginalWebSocket;
      if (originalUrl === undefined) delete process.env.MACARON_HERMES_URL; else process.env.MACARON_HERMES_URL = originalUrl;
    }
  });

  test.each(['streamed', 'fallback', 'interleaved', 'chronological', 'tool-fallback', 'tool-paragraph-break', 'status-only', 'trailing-reasoning', 'complete-suffix', 'interim-streamed', 'interim-fallback', 'interim-final-streamed', 'interim-final-fallback', 'divergent-final', 'terminal-error', 'terminal-interrupted'] as const)('resumes the durable session and preserves %s message boundaries', async mode => {
    const OriginalWebSocket = globalThis.WebSocket;
    const originalUrl = process.env.MACARON_HERMES_URL;
    const toolEvents: [string, Record<string, unknown>][] = [['tool.start', { tool_id: 'tool-1', name: 'read_file', args: {} }], ['tool.complete', { tool_id: 'tool-1', result: 'source' }]];
    const statuses: [string, Record<string, unknown>][] = [['thinking.delta', { text: 'pondering...' }], ['thinking.delta', { text: 'waiting on provider' }], ['thinking.delta', { text: '' }]];
    const failed = mode === 'terminal-error' || mode === 'terminal-interrupted';
    const events: [string, Record<string, unknown>][] = failed ? [
      ['message.delta', { text: 'partial answer' }], ['message.complete', { text: 'Error: provider failed', error: 'provider failed', status: mode === 'terminal-error' ? 'error' : 'interrupted' }],
    ] : mode === 'divergent-final' ? [
      ['message.delta', { text: 'preview' }], ['message.complete', { text: 'final answer' }],
    ] : mode === 'interim-final-streamed' || mode === 'interim-final-fallback' ? [
      ['message.delta', { text: 'answer' }], ['message.interim', { text: 'answer', already_streamed: mode === 'interim-final-streamed' }], ...statuses, ['message.complete', { text: 'answer' }],
    ] : mode === 'trailing-reasoning' || mode === 'complete-suffix' ? [
      ['message.delta', { text: 'answer' }], ['reasoning.delta', { text: 'trailing' }], ...statuses,
      ['message.complete', { text: mode === 'complete-suffix' ? 'answer suffix' : 'answer' }],
    ] : mode === 'interim-streamed' || mode === 'interim-fallback' ? [
      ...(mode === 'interim-streamed' ? [['message.delta', { text: 'preface' }]] as [string, Record<string, unknown>][] : []),
      ['message.interim', { text: 'preface', already_streamed: mode === 'interim-streamed' }], ...statuses, ['message.complete', { text: 'answer' }],
    ] : mode === 'chronological' ? [
      ['message.delta', { text: 'before ' }], ['message.delta', { text: 'tool' }], ...statuses, ...toolEvents,
      ['message.delta', { text: 'after tool' }], ['reasoning.delta', { text: 'check result' }], ...statuses,
      ['message.delta', { text: 'final answer' }], ['message.complete', { text: 'final answer' }],
    ] : mode === 'tool-paragraph-break' ? [
      ...toolEvents, ['message.delta', { text: '\n\n侧栏报告' }], ['message.delta', { text: '已同步修正。' }], ['message.complete', { text: '侧栏报告已同步修正。' }],
    ] : mode === 'tool-fallback' ? [
      ['message.delta', { text: 'before tool' }], ...toolEvents, ...statuses, ['message.complete', { text: 'final answer' }],
    ] : mode === 'status-only' ? [...statuses, ['message.complete', { text: 'answer' }]] : mode === 'interleaved' ? [
      ...statuses, ['reasoning.delta', { text: 'plan ' }], ['reasoning.delta', { text: 'first' }],
      ['tool.start', { tool_id: 'tool-1', name: 'read_file', args: {} }], ['tool.complete', { tool_id: 'tool-1', result: 'source' }],
      ...statuses, ['reasoning.delta', { text: 'check ' }], ['message.delta', { text: '' }], ['reasoning.delta', { text: 'result' }],
      ['message.delta', { text: 'answer' }], ['message.complete', { text: 'answer' }],
    ] : [...statuses, ['reasoning.delta', { text: 'plan' }], ...(mode === 'streamed' ? [['message.delta', { text: 'answer' }]] as [string, Record<string, unknown>][] : []), ['message.complete', { text: 'answer' }]];
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
        else if (request.method === 'prompt.submit') { reply({ status: 'streaming' }); queueMicrotask(() => { const sid = `runtime-${runtime}`; for (const [type, payload] of events) this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sid, payload } }) }); }); }
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
      const run = async (prompt: string) => {
        const chunks: ChatChunk[] = [], collect = async () => { for await (const chunk of hermesAdapter.run({ ...base, prompt, nativeId, onNativeSession: id => { nativeId = id; } })) chunks.push(chunk); };
        if (failed) await expect(collect()).rejects.toThrow('provider failed'); else await collect();
        return chunks;
      };
      const first = await run('first'), resumed = await run('second');
      const expectedParts = failed ? ['text:partial answer'] : mode === 'divergent-final' ? ['text:preview', 'text:final answer'] : mode === 'interim-final-streamed' || mode === 'interim-final-fallback' ? ['text:answer']
        : mode === 'trailing-reasoning' ? ['text:answer', 'reasoning:trailing'] : mode === 'complete-suffix' ? ['text:answer', 'reasoning:trailing', 'text: suffix']
        : mode === 'interim-streamed' || mode === 'interim-fallback' ? ['text:preface', 'text:answer'] : mode === 'chronological' ? ['text:before tool', 'tool:read_file', 'text:after tool', 'reasoning:check result', 'text:final answer']
        : mode === 'tool-paragraph-break' ? ['tool:read_file', 'text:\n\n侧栏报告已同步修正。'] : mode === 'tool-fallback' ? ['text:before tool', 'tool:read_file', 'text:final answer'] : mode === 'status-only' ? ['text:answer']
        : mode === 'interleaved' ? ['reasoning:plan first', 'tool:read_file', 'reasoning:check result', 'text:answer'] : ['reasoning:plan', 'text:answer'];
      for (const chunks of [first, resumed]) {
        const stream = new ReadableStream<ChatChunk>({ start(controller) { controller.enqueue({ type: 'start', messageId: 'normalized' }); for (const chunk of chunks) controller.enqueue(chunk); controller.enqueue({ type: 'finish', finishReason: failed ? 'error' : 'stop' }); controller.close(); } });
        let message: ChatMessage | undefined; for await (const value of readUIMessageStream<ChatMessage>({ stream })) message = value;
        expect(message?.parts.map(part => part.type === 'text' || part.type === 'reasoning' ? `${part.type}:${part.text}` : part.type === 'dynamic-tool' ? `tool:${part.toolName}` : part.type)).toEqual(expectedParts);
        expect(message?.parts.every(part => part.type !== 'text' && part.type !== 'reasoning' || part.state === 'done')).toBe(true);
        for (const kind of ['text', 'reasoning'] as const) {
          const starts = chunks.flatMap(chunk => chunk.type === `${kind}-start` && 'id' in chunk ? [chunk.id] : []), ends = chunks.flatMap(chunk => chunk.type === `${kind}-end` && 'id' in chunk ? [chunk.id] : []);
          expect(new Set(starts).size).toBe(starts.length);
          expect(ends).toEqual(starts);
        }
      }
      expect(decodeHermesNativeId(nativeId!).sessionId).toBe('runtime-2');
    } finally {
      await closeHermesConnections();
      globalThis.WebSocket = OriginalWebSocket;
      if (originalUrl === undefined) delete process.env.MACARON_HERMES_URL; else process.env.MACARON_HERMES_URL = originalUrl;
    }
  });
});
