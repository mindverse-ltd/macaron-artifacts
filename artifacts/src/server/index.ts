import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeUIMessageStreamToResponse } from 'ai';
import type { ChatMessage, HarnessId, Session } from '../shared/types.js';
import { adapters } from './harnesses/index.js';
import type { HarnessAdapter } from './harnesses/types.js';
import { SessionStore } from './store.js';
import { ActiveConversation } from './conversations.js';
import { MetadataTasks } from './enrichment.js';
import { listArtifacts, readUi4aFile, writeUi4aFile } from './artifacts.js';

export async function createArtifactsServer(options: { directory: string; instructions: string; harnesses?: Record<HarnessId, HarnessAdapter>; webRoot?: string }) {
  const store = new SessionStore(options.directory), active = new Map<string, ActiveConversation>(), claims = new Set<string>();
  const metadata = new MetadataTasks(store);
  const harnesses = options.harnesses ?? adapters;
  await store.load();
  const json = (res: ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 3 * 1024 * 1024) throw new Error('Request is too large.'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  const server = createServer(async (req, res) => {
    try {
    const url = new URL(req.url || '/', 'http://localhost'), segments = url.pathname.split('/').filter(Boolean);
    // Native harnesses can mutate files. A local browser must not let an unrelated origin trigger them.
    if (url.pathname.startsWith('/api/')) {
      const host = new URL(`http://${req.headers.host || 'invalid'}`).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return json(res, { error: 'A loopback host is required.' }, 403);
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, { error: 'Cross-origin requests are not accepted.' }, 403);
    }
      if (url.pathname === '/api/health') return json(res, { ok: true });
      if (url.pathname === '/api/harnesses' && req.method === 'GET') return json(res, await Promise.all(Object.values(harnesses).map(adapter => adapter.info())));
      if (url.pathname === '/api/sessions' && req.method === 'GET') return json(res, store.list());
      if (url.pathname === '/api/sessions' && req.method === 'POST') {
        const input = await body(req), harness = input.harness as HarnessId;
        if (!harnesses[harness]) return json(res, { error: 'Unsupported harness.' }, 400);
        const cwd = await realpath(typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd : process.cwd());
        if (!(await stat(cwd)).isDirectory()) return json(res, { error: 'Workspace must be a directory.' }, 400);
        const session: Session = { id: crypto.randomUUID(), harness, cwd, model: typeof input.model === 'string' && input.model ? input.model : undefined, title: '新会话', messages: [], suggestions: [], createdAt: Date.now(), updatedAt: Date.now(), status: 'idle' };
        await store.save(session); return json(res, session, 201);
      }
      if (segments[0] === 'api' && segments[1] === 'sessions' && segments[2]) {
        const session = store.sessions.get(segments[2]);
        if (!session) return json(res, { error: 'Session not found.' }, 404);
        if (segments.length === 3 && req.method === 'GET') return json(res, session);
        if (segments.length === 3 && req.method === 'DELETE') {
          if (claims.has(session.id)) return json(res, { error: 'This session is being updated.' }, 409);
          claims.add(session.id);
          try { const run = active.get(session.id); run?.stop(); await Promise.allSettled([run?.done, metadata.cancel(session.id)]); await store.delete(session.id); return json(res, { ok: true }); }
          finally { claims.delete(session.id); }
        }
        if (segments.length === 3 && req.method === 'PATCH') { const input = await body(req); if (store.sessions.get(session.id) !== session) return json(res, { error: 'Session not found.' }, 404); if (claims.has(session.id)) return json(res, { error: 'This session is being updated.' }, 409); void metadata.cancel(session.id); if (typeof input.title === 'string' && input.title.trim()) session.title = input.title.trim().slice(0, 100); await store.save(session); return json(res, session); }
        if (segments[3] === 'stop' && req.method === 'POST') {
          const run = active.get(session.id);
          if (run) { run.stop(); await run.done.catch(() => {}); if (active.get(session.id) === run) active.delete(session.id); }
          else void metadata.cancel(session.id);
          return json(res, { ok: true });
        }
        if (segments[3] === 'metadata' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' }); req.socket.setNoDelay(true);
          const unsubscribe = metadata.subscribe(session, { update: recap => res.write(`data: ${JSON.stringify(recap)}\n\n`), close: () => res.end() });
          res.on('close', unsubscribe); return;
        }
        if (segments[3] === 'approvals' && req.method === 'POST') {
          const input = await body(req);
          const decide = active.get(session.id)?.approvals.get(decodeURIComponent(segments[4]));
          if (!decide) return json(res, { error: 'Approval is no longer pending.' }, 409);
          decide(input.approved === true); return json(res, { ok: true });
        }
        if (segments[3] === 'artifacts' && req.method === 'GET') return json(res, await listArtifacts(session.cwd));
        if (segments[3] === 'files') {
          const path = url.searchParams.get('path') ?? '';
          if (req.method === 'GET') { const source = await readUi4aFile(session.cwd, path); res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); return res.end(source); }
          if (req.method === 'PUT') { const input = await body(req); if (typeof input.content !== 'string') return json(res, { error: 'content must be a string.' }, 400); await writeUi4aFile(session.cwd, path, input.content); return json(res, { ok: true }); }
        }
      }
      if (segments[0] === 'api' && segments[1] === 'chat' && segments[3] === 'stream' && req.method === 'GET') {
        const run = active.get(segments[2]);
        if (!run) { res.writeHead(204); return res.end(); }
        req.socket.setNoDelay(true);
        return await pipeUIMessageStreamToResponse({ response: res, stream: run.stream(), headers: { 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
      }
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        const input = await body(req), session = store.sessions.get(String(input.id));
        if (!session) return json(res, { error: 'Session not found.' }, 404);
        if (active.has(session.id) || claims.has(session.id)) return json(res, { error: 'This session already has a running turn.' }, 409);
        const messages = Array.isArray(input.messages) ? input.messages as ChatMessage[] : [];
        const user = messages.findLast(message => message.role === 'user');
        const prompt = user?.parts?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
        if (!user || !prompt) return json(res, { error: 'A user message is required.' }, 400);
        if (session.messages.some(message => message.id === user.id)) return json(res, { error: 'This message was already submitted.' }, 409);
        // Claim before the first await. Two simultaneous POSTs must never both
        // append a user message and start native turns for the same session.
        claims.add(session.id); void metadata.cancel(session.id);
        const previous = { ...session, messages: [...session.messages], suggestions: [...session.suggestions] };
        let run: ActiveConversation;
        try {
          session.messages.push({ id: user.id || crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: prompt }] });
          if (session.messages.length === 1) session.title = prompt.slice(0, 60);
          session.status = 'running'; session.error = undefined; session.suggestions = []; session.updatedAt = Date.now();
          await store.save(session);
          run = new ActiveConversation(store, session, harnesses[session.harness], options.instructions, prompt, metadata); active.set(session.id, run);
        } catch (error) { Object.assign(session, previous); throw error; }
        finally { claims.delete(session.id); }
        void run.done.finally(() => { if (active.get(session.id) === run) active.delete(session.id); }).catch(error => { console.error('Session persistence failed:', error); });
        req.socket.setNoDelay(true);
        return await pipeUIMessageStreamToResponse({ response: res, stream: run.stream(), headers: { 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
      }
      if (url.pathname.startsWith('/api/')) return json(res, { error: 'Not found.' }, 404);
      if (!options.webRoot) return json(res, { error: 'Start the Vite UI or build the app first.' }, 404);
      const path = resolve(options.webRoot, `.${url.pathname}`);
      if (path !== resolve(options.webRoot) && !path.startsWith(`${resolve(options.webRoot)}/`)) return json(res, { error: 'Not found.' }, 404);
      const file = extname(path) ? path : join(options.webRoot, 'index.html');
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json' };
      res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file));
    } catch (error) { if (!res.headersSent) json(res, { error: error instanceof Error ? error.message : 'Request failed.' }, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400); else res.end(); }
  });
  return { server, store, active, async close() { for (const run of active.values()) run.stop(); await Promise.allSettled([...active.values()].map(run => run.done)); await metadata.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('/src/server/index.ts') ? '../..' : '..');
  const instructions = await readFile(join(root, 'skills/ui4a/SKILL.md'), 'utf8');
  const app = await createArtifactsServer({ directory: process.env.MACARON_DATA_DIR || join(homedir(), '.macaron-artifacts/sessions'), instructions, webRoot: join(root, 'dist/web') });
  const port = Number(process.env.MACARON_PORT || 43860);
  app.server.listen(port, '127.0.0.1', () => console.log(`Macaron Artifacts: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void app.close().then(() => process.exit()); });
}
