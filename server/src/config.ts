import os from 'node:os';
import path from 'node:path';

export const PORT = parseInt(process.env.MACARON_PORT || '7878', 10);
export const HOST = process.env.MACARON_HOST || '127.0.0.1';

export const HOME = os.homedir();
export const CLAUDE_PROJECTS = path.join(HOME, '.claude', 'projects');

// Web root (repo's web/ dir). Same hop from compiled location in both dev (tsx src/) and prod (node dist/).
// src/config.ts → ../../web  (and after build: dist/config.js → ../../web)
export const WEB_ROOT = path.resolve(import.meta.dirname, '..', '..', 'web');

// Web assets (Vite build output). When running in dev (vite dev server on :5173 with proxy), this directory may not exist — @fastify/static handles that.
export const WEB_DIST = path.join(WEB_ROOT, 'dist');
