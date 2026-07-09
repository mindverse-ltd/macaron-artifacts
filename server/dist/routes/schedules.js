import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedule, setScheduleStatus, } from '../lib/schedule-store.js';
import { fireSchedule } from '../lib/scheduler.js';
async function assertRunnableCwd(cwd) {
    if (!path.isAbsolute(cwd))
        throw new Error('cwd must be an absolute path');
    const st = await fs.stat(cwd).catch(() => null);
    if (!st?.isDirectory())
        throw new Error('cwd must be an existing directory');
}
function normalizeInput(b) {
    const name = String(b.name || '').trim();
    const prompt = String(b.prompt || '').trim();
    const cwd = String(b.cwd || '').trim();
    const pattern = String(b.pattern || '').trim();
    const engine = b.engine === 'codex' ? 'codex' : 'claude';
    if (!name || !prompt || !cwd || !pattern)
        return null;
    return { name, prompt, cwd, pattern, engine, oneShot: Boolean(b.oneShot) };
}
export async function registerScheduleRoutes(app) {
    app.get('/api/schedules', async () => ({ schedules: await readSchedules() }));
    app.get('/api/schedules/:id', async ({ params }, reply) => {
        const s = getSchedule(params.id);
        if (!s)
            return reply.status(404).send({ error: 'schedule not found' });
        return s;
    });
    app.post('/api/schedules', async (req, reply) => {
        const input = normalizeInput(req.body || {});
        if (!input)
            return reply.status(400).send({ error: 'name, prompt, cwd and pattern are required' });
        try {
            await assertRunnableCwd(input.cwd);
            return await createSchedule(input);
        }
        catch (e) {
            return reply.status(400).send({ error: e.message });
        }
    });
    app.put('/api/schedules/:id', async (req, reply) => {
        const b = req.body || {};
        const patch = {};
        if (typeof b.name === 'string') {
            patch.name = b.name.trim();
            if (!patch.name)
                return reply.status(400).send({ error: 'name required' });
        }
        if (typeof b.prompt === 'string') {
            patch.prompt = b.prompt.trim();
            if (!patch.prompt)
                return reply.status(400).send({ error: 'prompt required' });
        }
        if (typeof b.cwd === 'string') {
            patch.cwd = b.cwd.trim();
            if (!patch.cwd)
                return reply.status(400).send({ error: 'cwd required' });
        }
        if (typeof b.pattern === 'string') {
            patch.pattern = b.pattern.trim();
            if (!patch.pattern)
                return reply.status(400).send({ error: 'pattern required' });
        }
        if (b.engine === 'claude' || b.engine === 'codex')
            patch.engine = b.engine;
        if (typeof b.oneShot === 'boolean')
            patch.oneShot = b.oneShot;
        try {
            if (patch.cwd !== undefined)
                await assertRunnableCwd(patch.cwd);
            const updated = await updateSchedule(req.params.id, patch);
            if (!updated)
                return reply.status(404).send({ error: 'schedule not found' });
            return updated;
        }
        catch (e) {
            return reply.status(400).send({ error: e.message });
        }
    });
    app.delete('/api/schedules/:id', async ({ params }, reply) => {
        const ok = await deleteSchedule(params.id);
        if (!ok)
            return reply.status(404).send({ error: 'schedule not found' });
        return { ok: true };
    });
    app.post('/api/schedules/:id/pause', async ({ params }, reply) => {
        const s = await setScheduleStatus(params.id, 'paused');
        if (!s)
            return reply.status(404).send({ error: 'schedule not found' });
        return s;
    });
    app.post('/api/schedules/:id/resume', async ({ params }, reply) => {
        const s = await setScheduleStatus(params.id, 'active');
        if (!s)
            return reply.status(404).send({ error: 'schedule not found' });
        return s;
    });
    // Fire immediately without touching nextRunAt — a manual test/kick that
    // leaves the schedule on its normal cadence.
    app.post('/api/schedules/:id/run-now', async ({ params }, reply) => {
        const s = getSchedule(params.id);
        if (!s)
            return reply.status(404).send({ error: 'schedule not found' });
        const result = await fireSchedule(s, false);
        if (!result.ok)
            return reply.status(result.error === 'schedule already running' ? 409 : 500).send({ error: result.error || 'schedule run failed' });
        return { ok: true, sessionId: result.sessionId };
    });
}
//# sourceMappingURL=schedules.js.map