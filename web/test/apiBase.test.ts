import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// jsdom-free localStorage shim so apiBase's storage-backed cache works under
// node:test. Must be installed before importing the module (it caches on read).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

const { getApiBase, setApiBase, clearApiBase, resolveApiUrl, isLoopbackBase } = await import('../src/lib/apiBase');

beforeEach(() => clearApiBase());

test('same-origin (empty base): /api paths pass through untouched', () => {
  assert.equal(getApiBase(), '');
  assert.equal(resolveApiUrl('/api/workspaces'), '/api/workspaces');
  assert.equal(resolveApiUrl('/api/events?token=x'), '/api/events?token=x');
});

test('with a base: /api and /relay paths are retargeted, others are not', () => {
  setApiBase('https://tunnel.test');
  assert.equal(resolveApiUrl('/api/workspaces'), 'https://tunnel.test/api/workspaces');
  assert.equal(resolveApiUrl('/relay/foo'), 'https://tunnel.test/relay/foo');
  assert.equal(resolveApiUrl('/sw.js'), '/sw.js');           // asset stays local
  assert.equal(resolveApiUrl('/assets/x.js'), '/assets/x.js');
});

test('setApiBase stores the origin only and strips a trailing path', () => {
  setApiBase('https://tunnel.test/'); // trailing slash is the root path — allowed
  assert.equal(getApiBase(), 'https://tunnel.test');
});

test('setApiBase rejects a base that carries a path (no silent reroute)', () => {
  assert.throws(() => setApiBase('https://tunnel.test/deep/path'));
});

test('setApiBase rejects garbage', () => {
  assert.throws(() => setApiBase('not a url ::::'));
});

test('http://localhost base is honored (loopback)', () => {
  setApiBase('http://localhost:7878');
  assert.equal(resolveApiUrl('/api/health'), 'http://localhost:7878/api/health');
  assert.equal(isLoopbackBase(), true);
});

test('isLoopbackBase: 127.x and ::1 are loopback, public host is not', () => {
  setApiBase('http://127.0.0.1:7979');
  assert.equal(isLoopbackBase(), true);
  setApiBase('http://[::1]:7878');
  assert.equal(isLoopbackBase(), true);
  setApiBase('https://xxx.trycloudflare.com');
  assert.equal(isLoopbackBase(), false);
});

test('clearApiBase reverts to same-origin passthrough', () => {
  setApiBase('https://tunnel.test');
  clearApiBase();
  assert.equal(getApiBase(), '');
  assert.equal(resolveApiUrl('/api/x'), '/api/x');
});
