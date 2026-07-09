import { type CodexRuntimeOverride } from './codex-config.js';
import type { RunnerEvent, AttachedImage } from './claude-runner.js';
export declare const CODEX_BINARY: string | undefined;
export type CodexRunOptions = {
    prompt: string;
    cwd: string;
    /** Resume an existing thread_id. Omit for a new thread. */
    resume?: string;
    abortController?: AbortController;
    images?: AttachedImage[];
    /** Per-turn runtime knobs; each field falls back to the global default. */
    runtime?: CodexRuntimeOverride;
};
export declare function runCodex(opts: CodexRunOptions): AsyncGenerator<RunnerEvent>;
//# sourceMappingURL=codex-runner.d.ts.map