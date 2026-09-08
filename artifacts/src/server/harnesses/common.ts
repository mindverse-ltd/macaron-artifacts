import { execFile } from 'node:child_process';

/** A callback producer can fail while its consumer is awaiting the next native event. */
export class EventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private wake?: () => void;
  private ended = false;
  private error?: unknown;
  push(value: T) { if (!this.ended) { this.values.push(value); this.wake?.(); } }
  end() { this.ended = true; this.wake?.(); }
  fail(error: unknown) { this.error = error; this.end(); }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.values.length) { yield this.values.shift()!; continue; }
      if (this.error) throw this.error;
      if (this.ended) return;
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = undefined;
    }
  }
}

export function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}; }
export function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function abortError(): Error { return new DOMException('The turn was interrupted', 'AbortError'); }
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function executableVersion(binary: string): Promise<string | undefined> {
  return new Promise((resolve) => execFile(binary, ['--version'], { timeout: 5000, maxBuffer: 4096 }, (error, stdout) => resolve(error ? undefined : stdout.trim())));
}

// Native diagnostics occasionally include authorization headers; never expose those in the WebUI.
export function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]');
}
