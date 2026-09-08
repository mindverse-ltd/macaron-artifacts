#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === '--help' || flag === '-h') { console.log('Usage: macaron-artifacts [--port 43860] [--data-dir PATH]\n\nOne local WebUI for Claude Code, Codex and UI4A. Harnesses use their native local configuration.'); process.exit(0); }
  const value = args[++i];
  if (!value || value.startsWith('--') || !['--port', '--data-dir'].includes(flag)) { console.error(`Invalid option: ${flag}`); process.exit(1); }
  if (flag === '--port' && (!/^\d+$/.test(value) || +value < 1 || +value > 65535)) { console.error('Port must be between 1 and 65535.'); process.exit(1); }
  process.env[flag === '--port' ? 'MACARON_PORT' : 'MACARON_DATA_DIR'] = value;
}
const server = fileURLToPath(new URL('../artifacts/dist/server.js', import.meta.url));
try { await access(server); } catch { console.error('Build the app first with pnpm build.'); process.exit(1); }
const child = spawn(process.execPath, [server], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
