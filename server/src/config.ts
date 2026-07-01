import os from 'node:os';
import path from 'node:path';

export const PORT = parseInt(process.env.MACARON_PORT || '7878', 10);
export const HOST = process.env.MACARON_HOST || '127.0.0.1';

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. See .env.example — export it in your shell or a local .env before starting the server.`,
    );
  }
  return v;
}

export const MACARON_API_BASE = requiredEnv('MACARON_API_BASE');
export const MACARON_API_KEY = requiredEnv('MACARON_API_KEY');
export const MACARON_MODEL = process.env.MACARON_MODEL || 'macaron-0.6';

export const GENUI_SYSTEM_PROMPT_URL = 'https://genui.macaron.im/api/system-prompt';

export const HOME = os.homedir();
export const CLAUDE_PROJECTS = path.join(HOME, '.claude', 'projects');

// Web assets (Vite build output). When running in dev (vite dev server on :5173
// with proxy), this directory may not exist — @fastify/static handles that.
// src/config.ts → ../../web/dist  (and after build: dist/config.js → ../../web/dist)
export const WEB_DIST = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  'web',
  'dist',
);
