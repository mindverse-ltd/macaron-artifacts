import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { listArtifacts } from './artifacts.js';
const MAX_BYTES = 128 * 1024, MAX_RESULTS = 20;
function safeTarget(cwd: string, path: string) { const root = resolve(cwd), target = resolve(root, path), rel = relative(root, target); if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`${sep}.git${sep}`) || rel.includes(`${sep}node_modules${sep}`)) throw new Error('引用文件必须在当前工作区内。'); return target; }
export async function searchWorkspaceFiles(cwd: string, query: string) {
  const normalized = query.trim().toLowerCase(), result: { path: string; label: string }[] = [];
  async function visit(directory: string, depth: number) { if (depth > 5 || result.length >= MAX_RESULTS) return; for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) { if (entry.name.startsWith('.') && entry.name !== '.artifacts' || entry.name === 'node_modules') continue; const path = relative(cwd, resolve(directory, entry.name)), target = resolve(directory, entry.name); if (entry.isDirectory()) { await visit(target, depth + 1); } else if (entry.isFile() && path.toLowerCase().includes(normalized)) result.push({ path, label: path }); if (result.length >= MAX_RESULTS) return; } }
  await visit(cwd, 0);
  if ('canvas'.startsWith(normalized) || normalized === '') result.unshift({ path: 'Canvas', label: 'Canvas' });
  return result.slice(0, MAX_RESULTS);
}
export async function expandPromptReferences(cwd: string, prompt: string) {
  const tokens = [...prompt.matchAll(/(^|\s)@([A-Za-z0-9_./-]{1,180})/g)].map(match => match[2]).filter((path, index, all) => all.indexOf(path) === index);
  if (!tokens.length) return prompt;
  const blocks: string[] = [];
  for (const token of tokens) {
    if (token === 'Canvas') { const files = await listArtifacts(cwd); for (const file of files) blocks.push(`### ${file.path}\n${file.source}`); continue; }
    const target = safeTarget(cwd, token), actual = await realpath(target), rel = relative(await realpath(cwd), actual); if (rel.startsWith(`..${sep}`) || rel === '..' || !rel) throw new Error('引用文件路径无效。');
    const info = await stat(actual); if (!info.isFile() || info.size > MAX_BYTES) throw new Error(`引用文件过大或不可读取：${token}`);
    blocks.push(`### ${token}\n${await readFile(actual, 'utf8')}`);
  }
  return `${prompt}\n\n<referenced_context>\n${blocks.join('\n\n')}\n</referenced_context>`;
}
