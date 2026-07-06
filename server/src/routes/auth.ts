import type { FastifyInstance } from 'fastify';
import type { AuthStatusResponse } from '@macaron/shared';
import { isLoopback, tokensMatch } from '../lib/auth.js';

// `token` is the armed shared secret ('' when auth is off). Registered inside
// the same encapsulated scope as the other routes, but these two paths are
// exempt from the auth hook so the login screen can always reach them.
export async function registerAuthRoutes(app: FastifyInstance, token: string): Promise<void> {
  // Whether THIS caller must authenticate: a token is armed and they're remote.
  app.get('/api/auth/status', async (req): Promise<AuthStatusResponse> => {
    return { required: Boolean(token) && !isLoopback(req.ip) };
  });

  app.post<{ Body: { token?: string } }>('/api/auth/login', async (req, reply) => {
    const provided = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token || tokensMatch(provided, token)) return { ok: true };
    return reply.code(401).send({ error: 'invalid token' });
  });
}
