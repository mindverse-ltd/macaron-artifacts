import type { FastifyInstance } from 'fastify';
import {
  readPublicMcpServers,
  addServer,
  updateServer,
  deleteServer,
  type McpServerInput,
  type McpTransport,
} from '../lib/mcp-store.js';

type Body = {
  name?: string;
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

function parseBody(b: Body): McpServerInput | { error: string } {
  const transport = String(b.transport || '') as McpTransport;
  if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
    return { error: 'transport must be stdio, http, or sse' };
  }
  return {
    name: String(b.name || ''),
    transport,
    command: typeof b.command === 'string' ? b.command : undefined,
    args: Array.isArray(b.args) ? b.args.map(String) : undefined,
    url: typeof b.url === 'string' ? b.url : undefined,
    env: b.env && typeof b.env === 'object' ? b.env : undefined,
    headers: b.headers && typeof b.headers === 'object' ? b.headers : undefined,
  };
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mcp/servers', async () => ({ servers: await readPublicMcpServers() }));

  app.post<{ Body: Body }>('/api/mcp/servers', async (req, reply) => {
    const parsed = parseBody(req.body || {});
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
    try {
      const r = await addServer(parsed);
      if ('status' in r) return reply.status(r.status).send({ error: r.message });
      return { servers: await readPublicMcpServers() };
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  app.put<{ Params: { name: string }; Body: Body }>('/api/mcp/servers/:name', async (req, reply) => {
    const parsed = parseBody(req.body || {});
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
    try {
      const r = await updateServer(req.params.name, parsed);
      if ('status' in r) return reply.status(r.status).send({ error: r.message });
      return { servers: await readPublicMcpServers() };
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { name: string } }>('/api/mcp/servers/:name', async (req, reply) => {
    try {
      const r = await deleteServer(req.params.name);
      if ('status' in r) return reply.status(r.status).send({ error: r.message });
      return { servers: await readPublicMcpServers() };
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });
}
