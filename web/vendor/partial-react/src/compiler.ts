import initTsx, { transform as transformTsx } from "@esm.sh/tsx";
import tsxWasmUrl from "@esm.sh/tsx/pkg/tsx_bg.wasm?url";
import { normalizeGeneratedTsx } from "partial-tsx";
import type { RendererImportMap } from "./importMap";

export type CompileOptions = { importMap?: RendererImportMap; partial?: boolean; previousCode?: string; filename?: string; jsxImportSource?: string };
export type CompileResult = { code: string; source: string; changed: boolean };
export type TsxCompiler = { compile: (code: string, options?: CompileOptions) => Promise<CompileResult> };

let initPromise: Promise<unknown> | null = null;
const loadNodeWasm = async () => {
  if (typeof Bun === "undefined") throw new Error("Bun runtime is required to load local TSX WASM in tests.");
  const wasmPath = new URL(import.meta.resolve("@esm.sh/tsx/pkg/tsx_bg.wasm"));
  return Bun.file(wasmPath).arrayBuffer();
};
const initCompiler = () =>
  (initPromise ??= (async () => {
    try {
      if (typeof window === "undefined") return initTsx(await loadNodeWasm());
    } catch {
      // Browser builds should use Vite's asset URL; Node tests use the direct filesystem path above.
    }
    return initTsx(tsxWasmUrl);
  })().catch((error) => {
    initPromise = null;
    throw error;
  }));

export function createTsxCompiler(): TsxCompiler {
  return {
    async compile(code, options = {}) {
      await initCompiler();
      const source = options.partial ? normalizeGeneratedTsx(code) : code;
      const result = transformTsx({ filename: options.filename ?? "_.tsx", code: source, target: "es2022", importMap: options.importMap, jsxImportSource: options.jsxImportSource ?? "react" });
      const compiled = new TextDecoder().decode(result.code);
      return { code: compiled, source, changed: compiled !== options.previousCode };
    },
  };
}
