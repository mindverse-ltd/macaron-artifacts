import { describe, expect, test } from 'bun:test';
import { decodeOpenClawNativeId, encodeOpenClawNativeId } from './openclaw.js';

describe('OpenClaw native session identity', () => {
  test('round-trips Gateway key, session id and cwd without exposing credentials', () => {
    const encoded = encodeOpenClawNativeId({ key: 'agent:main:macaron', id: 'session-1', cwd: '/tmp/workspace' });
    expect(encoded.startsWith('openclaw:')).toBe(true);
    expect(decodeOpenClawNativeId(encoded, '/other')).toEqual({ key: 'agent:main:macaron', id: 'session-1', cwd: '/tmp/workspace' });
    expect(encoded).not.toContain('token');
  });

  test('accepts legacy raw Gateway keys while pinning the requested cwd', () => {
    expect(decodeOpenClawNativeId('agent:main:legacy', '/tmp/workspace')).toEqual({ key: 'agent:main:legacy', cwd: '/tmp/workspace' });
  });
});
