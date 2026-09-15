import { watch, type FSWatcher } from 'node:fs';
import { lstat, mkdir, readFile, realpath, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Allow, parse } from 'partial-json';
import type { Artifact, ChatChunk } from '../shared/types.js';
import { isArtifactEntry } from '../shared/artifact-path.js';
export { isArtifactEntry } from '../shared/artifact-path.js';

const MAX_BYTES = 2 * 1024 * 1024;
export function ui4aPath(cwd: string, path: string) {
  const target = resolve(cwd, path), rel = relative(resolve(cwd), target);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !rel.startsWith(`.artifacts${sep}`)) throw new Error('Files must be inside this workspace’s .artifacts directory.');
  return target;
}
export async function checkedPath(cwd: string, path: string, writing = false): Promise<string> {
  const target = ui4aPath(cwd, path), base = join(await realpath(cwd), '.artifacts');
  try {
    if ((await lstat(base)).isSymbolicLink()) throw new Error('Symlinks cannot replace the .artifacts root.');
  } catch (error) {
    // A missing root has no descendants that could redirect the first write.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && writing) return target;
    throw error;
  }
  let existing = target;
  while (true) {
    try {
      const actual = await realpath(existing), rel = relative(base, actual);
      if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('Symlinks must stay inside .artifacts.');
      return resolve(actual, relative(existing, target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !writing) throw error;
      // realpath cannot resolve a dangling link, but writeFile would still follow it
      // and create its target. Do not mistake that link for a missing path segment.
      if ((await lstat(existing).catch(() => undefined))?.isSymbolicLink()) throw new Error('Symlinks must resolve inside .artifacts.');
      existing = dirname(existing);
    }
  }
}
export async function readUi4aFile(cwd: string, path: string) {
  const target = await checkedPath(cwd, path);
  if ((await stat(target)).size > MAX_BYTES) throw new Error('UI4A files are limited to 2 MB.');
  return readFile(target, 'utf8');
}
export async function writeUi4aFile(cwd: string, path: string, content: string) {
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('UI4A files are limited to 2 MB.');
  const target = await checkedPath(cwd, path, true);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}
export async function listArtifacts(cwd: string, revision = Date.now()): Promise<Artifact[]> {
  const paths: string[] = [];
  for (const dir of ['.artifacts', '.artifacts/canvases']) {
    for (const item of await readdir(join(cwd, dir), { withFileTypes: true }).catch(() => [])) {
      const path = `${dir}/${item.name}`;
      if (item.isFile() && isArtifactEntry(path)) paths.push(path);
    }
  }
  const files = await Promise.all(paths.map(async path => {
    try { return { path, source: await readUi4aFile(cwd, path), streaming: false, revision }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }));
  return files.filter((file): file is Artifact => file !== undefined);
}

export class ArtifactObserver {
  private inputs = new Map<string, string>();
  private names = new Map<string, string>();
  private sources = new Map<string, string>();
  private published = new Map<string, Artifact>();
  private previews = new Map<string, { path: string; source: string }>();
  private bases = new Map<string, string>();
  private watchers: FSWatcher[] = [];
  private revision = Date.now();
  private closed = false;
  private finishing = false;
  private scanning?: Promise<void>;
  private dirty = false;
  constructor(private cwd: string, private emit: (chunk: ChatChunk) => void) {}
  async start() {
    const observe = () => {
      if (this.watchers.length > 1 || this.closed) return;
      try { this.watchers.push(watch(join(this.cwd, '.artifacts'), { recursive: true }, () => this.refresh())); } catch { /* A workspace may not have artifacts yet. */ }
    };
    this.watchers.push(watch(this.cwd, (_, name) => { if (name === '.artifacts') { observe(); this.refresh(); } }));
    observe();
    await this.refresh();
  }
  refresh() {
    if (this.closed) return Promise.resolve();
    this.dirty = true;
    if (this.scanning) return this.scanning;
    // Coalesce filesystem notifications into another scan, not an unbounded queue
    // of stale snapshots. Tool-input deltas still pass through accept immediately.
    this.scanning = (async () => {
      while (this.dirty && !this.closed) {
        this.dirty = false;
        const files = await listArtifacts(this.cwd, ++this.revision);
        if (this.closed) return;
        const previewPaths = new Set([...this.previews.values()].map(preview => preview.path));
        for (const artifact of files) {
          this.sources.set(artifact.path, artifact.source);
          // A watcher for another file must not replace an unfinished Write with its old disk contents.
          if (!previewPaths.has(artifact.path)) this.publish(artifact.path, artifact.source, false);
        }
        const existing = new Set(files.map(file => file.path));
        for (const path of this.published.keys()) if (!existing.has(path) && !previewPaths.has(path)) {
          this.sources.delete(path); this.published.delete(path);
          this.emit({ type: 'data-artifact', id: path, data: { path, source: '', streaming: false, revision: ++this.revision, deleted: true } });
        }
      }
    })().finally(() => { this.scanning = undefined; });
    return this.scanning;
  }
  accept(chunk: ChatChunk) {
    if (this.closed || this.finishing) return;
    if (chunk.type === 'tool-input-start') this.names.set(chunk.toolCallId, chunk.toolName);
    if (chunk.type === 'tool-output-available' || chunk.type === 'tool-output-error' || chunk.type === 'tool-input-error' || chunk.type === 'tool-output-denied') {
      const path = this.previews.get(chunk.toolCallId)?.path;
      this.previews.delete(chunk.toolCallId); this.inputs.delete(chunk.toolCallId); this.names.delete(chunk.toolCallId); this.bases.delete(chunk.toolCallId);
      const active = path && [...this.previews].findLast(([, preview]) => preview.path === path);
      if (active) this.publish(active[1].path, active[1].source, true, active[0]);
      // The caller must await reconciliation before accepting the next tool's Edit base.
      return this.refresh();
    }
    if (chunk.type !== 'tool-input-delta' && chunk.type !== 'tool-input-available') return;
    const id = chunk.toolCallId, name = chunk.type === 'tool-input-available' ? chunk.toolName : this.names.get(id) ?? '';
    const edit = /(?:^|[._])edit(?:_file)?$/i.test(name);
    if (!edit && !/(?:^|[._])(?:write|create)(?:_file)?$/i.test(name)) return;
    try {
      let input: Record<string, unknown>, complete: Record<string, unknown>;
      if (chunk.type === 'tool-input-delta') {
        const json = (this.inputs.get(id) ?? '') + chunk.inputTextDelta; this.inputs.set(id, json);
        input = parse(json); complete = parse(json, Allow.OBJ);
      } else input = complete = chunk.input as Record<string, unknown>;
      const path = complete.file_path ?? complete.path;
      if (typeof path !== 'string') return;
      const rel = relative(this.cwd, ui4aPath(this.cwd, path)).split(sep).join('/');
      if (!isArtifactEntry(rel)) return;
      let source = input.content;
      if (edit) {
        const old = complete.old_string, replacement = input.new_string;
        if (typeof old !== 'string' || !old || typeof replacement !== 'string') return;
        if (!this.bases.has(id) && this.sources.has(rel)) this.bases.set(id, this.sources.get(rel)!);
        const base = this.bases.get(id), first = base?.indexOf(old) ?? -1;
        // Rebuild the module from a stable pre-edit snapshot; never feed new_string alone to the renderer.
        // Ambiguous anchors wait for an explicit replace_all, just as a native Edit would.
        if (base === undefined || first < 0 || base.indexOf(old, first + old.length) >= 0 && complete.replace_all !== true) return;
        source = complete.replace_all === true ? base.split(old).join(replacement) : base.slice(0, first) + replacement + base.slice(first + old.length);
      }
      if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES) return;
      // Reinsert on every update so a rejected owner restores the most recently updated active preview.
      this.previews.delete(id); this.previews.set(id, { path: rel, source }); this.publish(rel, source, true, id);
    } catch { /* Partial JSON and paths are expected while the native tool input is streaming. */ }
  }
  private publish(path: string, source: string, streaming: boolean, toolCallId?: string) {
    const prior = this.published.get(path);
    if (prior?.source === source && prior.streaming === streaming && prior.toolCallId === toolCallId) return;
    const data = { path, source, streaming, revision: ++this.revision, ...(toolCallId ? { toolCallId } : {}) };
    this.published.set(path, data); this.emit({ type: 'data-artifact', id: path, data });
  }
  async finish() {
    this.finishing = true;
    // Stop new scan producers before taking the final disk snapshot. Otherwise an
    // already queued watcher can emit after finish and reopen a supposedly settled artifact.
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    this.previews.clear(); this.inputs.clear(); this.names.clear(); this.bases.clear();
    await this.refresh();
    this.closed = true;
  }
  async close() { this.closed = true; for (const watcher of this.watchers) watcher.close(); this.watchers = []; await this.scanning?.catch(() => {}); }
}
