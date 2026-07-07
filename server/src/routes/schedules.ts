import type { FastifyInstance } from 'fastify';
import type { ScheduleInput, SessionKind } from '@macaron/shared';
import {
  readSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  setScheduleStatus,
} from '../lib/schedule-store.js';
import { fireSchedule } from '../lib/scheduler.js';

type IdParams = { id: string };
type Body = Partial<ScheduleInput>;

function normalizeInput(b: Body): ScheduleInput | null {
  const name = String(b.name || '').trim();
  const prompt = String(b.prompt || '').trim();
  const cwd = String(b.cwd || '').trim();
  const pattern = String(b.pattern || '').trim();
  const engine: SessionKind = b.engine === 'codex' ? 'codex' : 'claude';
  if (!name || !prompt || !cwd || !pattern) return null;
  return { name, prompt, cwd, pattern, engine, oneShot: Boolean(b.oneShot) };
}

export async function registerScheduleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/schedules', async () => ({ schedules: await readSchedules() }));

  app.get<{ Params: IdParams }>('/api/schedules/:id', async ({ params }, reply) => {
    const s = getSchedule(params.id);
    if (!s) return reply.status(404).send({ error: 'schedule not found' });
    return s;
  });

  app.post<{ Body: Body }>('/api/schedules', async (req, reply) => {
    const input = normalizeInput(req.body || {});
    if (!input) return reply.status(400).send({ error: 'name, prompt, cwd and pattern are required' });
    try {
      return await createSchedule(input);
    } catch (e) {
      return reply.status(400).send({ error: `invalid pattern: ${(e as Error).message}` });
    }
  });

  app.put<{ Params: IdParams; Body: Body }>('/api/schedules/:id', async (req, reply) => {
    const b = req.body || {};
    const patch: Body = {};
    if (typeof b.name === 'string') patch.name = b.name.trim();
    if (typeof b.prompt === 'string') patch.prompt = b.prompt.trim();
    if (typeof b.cwd === 'string') patch.cwd = b.cwd.trim();
    if (typeof b.pattern === 'string') patch.pattern = b.pattern.trim();
    if (b.engine === 'claude' || b.engine === 'codex') patch.engine = b.engine;
    if (typeof b.oneShot === 'boolean') patch.oneShot = b.oneShot;
    try {
      const updated = await updateSchedule(req.params.id, patch);
      if (!updated) return reply.status(404).send({ error: 'schedule not found' });
      return updated;
    } catch (e) {
      return reply.status(400).send({ error: `invalid pattern: ${(e as Error).message}` });
    }
  });

  app.delete<{ Params: IdParams }>('/api/schedules/:id', async ({ params }, reply) => {
    const ok = await deleteSchedule(params.id);
    if (!ok) return reply.status(404).send({ error: 'schedule not found' });
    return { ok: true };
  });

  app.post<{ Params: IdParams }>('/api/schedules/:id/pause', async ({ params }, reply) => {
    const s = await setScheduleStatus(params.id, 'paused');
    if (!s) return reply.status(404).send({ error: 'schedule not found' });
    return s;
  });

  app.post<{ Params: IdParams }>('/api/schedules/:id/resume', async ({ params }, reply) => {
    const s = await setScheduleStatus(params.id, 'active');
    if (!s) return reply.status(404).send({ error: 'schedule not found' });
    return s;
  });

  // Fire immediately without touching nextRunAt — a manual test/kick that
  // leaves the schedule on its normal cadence.
  app.post<{ Params: IdParams }>('/api/schedules/:id/run-now', async ({ params }, reply) => {
    const s = getSchedule(params.id);
    if (!s) return reply.status(404).send({ error: 'schedule not found' });
    void fireSchedule(s, false);
    return { ok: true };
  });
}
