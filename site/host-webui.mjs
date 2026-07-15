// Build the Macaron WebUI (the /web SPA) and stage it under the docs site's
// build output at /app, so artifacts.macaron.im can HOST the exact same
// front-end that `mcc`/`mcx` serve locally — not redirect to a server origin.
//
// It reuses /web's existing vite build verbatim (no source fork): the only
// override is `--base=/app/`, which rewrites every asset URL to /app/assets/*.
// Both SPA entries ship: index.html (Claude Code) and codex.html (Codex). Their
// hash router keeps deep links inside the '#' fragment, so no server-side SPA
// fallback is needed under /app — the two static HTML files are enough.
//
// Run after `react-router build`: the docs client lands in build/client, then
// we drop web/dist alongside it at build/client/app.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(siteDir, '..');
const webDir = path.join(repoRoot, 'web');
const webDist = path.join(webDir, 'dist');
const target = path.join(siteDir, 'build', 'client', 'app');

console.log('[host-webui] building /web with base=/app/ …');
execFileSync('pnpm', ['exec', 'vite', 'build', '--base=/app/'], { cwd: webDir, stdio: 'inherit' });

if (!existsSync(path.join(webDist, 'index.html')) || !existsSync(path.join(webDist, 'codex.html'))) {
  throw new Error('[host-webui] web/dist is missing index.html or codex.html after build');
}

if (existsSync(target)) rmSync(target, { recursive: true });
cpSync(webDist, target, { recursive: true });
console.log(`[host-webui] staged WebUI at ${path.relative(repoRoot, target)} (Claude Code: /app, Codex: /app/codex)`);
