import { createTsxCompiler, type TsxCompiler } from "partial-react/compiler";
import { createImportMapResolver, extractImportSpecifiers, literalImportMap, rewriteImportSpecifiers, type RendererImportMap } from "partial-react/import-map";
import { createEsmShModuleResolver, transformedEsmShFallback } from "partial-react/remote-module";
import { relativeUi4aPath, ui4aPath } from "./files";
import { ui4aModules } from "./manifest";

export type PreparedImports = { importMap: RendererImportMap; rewrite: (source: string) => string };
export type ImportRequest = { source: string; filename?: string; revision?: string | number };
const relative = (specifier: string) => specifier.startsWith("./") || specifier.startsWith("../");
export const importSignature = ({ source, filename, revision }: ImportRequest) => JSON.stringify([filename, revision, [...extractImportSpecifiers(source)].sort()]);

export function createSurfaceImports(baseImports: Record<string, string>, readFile: (path: string) => Promise<string>, options: { compiler?: TsxCompiler; fallback?: ReturnType<typeof transformedEsmShFallback>; createModuleUrl?: (code: string) => string; revokeModuleUrl?: (url: string) => void } = {}) {
  const compiler = options.compiler ?? createTsxCompiler();
  const urls = new Set<string>();
  let disposed = false;
  const createModuleUrl = (code: string) => {
    if (disposed) throw new Error("UI4A surface was closed");
    const url = options.createModuleUrl?.(code) ?? URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    urls.add(url);
    return url;
  };
  const fallback = options.fallback ?? transformedEsmShFallback({ dev: import.meta.env?.DEV, resolveEsmSh: createEsmShModuleResolver({ compiler, createModuleUrl }) });
  const resolver = createImportMapResolver([literalImportMap({ imports: baseImports }), fallback]);
  const resolveBare = async (source: string) => {
    for (const specifier of extractImportSpecifiers(source)) if (specifier.startsWith("$ui4a/") && !Object.hasOwn(ui4aModules, specifier)) throw new Error(`UI4A module ${specifier} is unavailable. Use ${Object.keys(ui4aModules).join(", ")}.`);
    return resolver.resolve({ code: source });
  };

  return {
    async resolve({ source, filename }: ImportRequest): Promise<PreparedImports> {
      const modules = new Map<string, string>();
      const loaded = new Map<string, { filename: string; source: string }>();
      const localSpecifiers = [...extractImportSpecifiers(source)].filter(relative);
      if (localSpecifiers.length && !filename) throw new Error("Relative imports require a .ui4a file canvas; inline UI can import React and $ui4a modules directly.");
      const readModule = async (requested: string) => {
        const cached = loaded.get(requested);
        if (cached) return cached;
        const candidates = /\.[cm]?[jt]sx?$|\.json$/.test(requested) ? [requested] : [requested, ...[".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", ".json"].map((suffix) => requested + suffix)];
        for (const filename of candidates) {
          try {
            const found = { filename, source: await readFile(filename) };
            loaded.set(requested, found);
            return found;
          } catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
        }
        throw new Error(`UI4A module ${requested} was not found`);
      };
      const compileModule = async (requested: string, ancestors: string[]): Promise<string> => {
        const found = await readModule(requested);
        if (ancestors.includes(found.filename)) throw new Error(`Circular UI4A imports: ${[...ancestors, found.filename].join(" → ")}`);
        const cached = modules.get(found.filename);
        if (cached) return cached;
        if (loaded.size > 128) throw new Error("UI4A canvas imports more than 128 modules");
        const source = found.filename.endsWith(".json") ? `export default ${JSON.stringify(JSON.parse(found.source))};` : found.source;
        const rewrites: Record<string, string> = {};
        // Resolve each branch to completion before caching it: two concurrent cyclic branches can otherwise await each other forever.
        for (const specifier of extractImportSpecifiers(source)) if (relative(specifier)) rewrites[specifier] = await compileModule(relativeUi4aPath(specifier, found.filename), [...ancestors, found.filename]);
        const importMap = await resolveBare(source);
        const result = await compiler.compile(rewriteImportSpecifiers(source, rewrites), { filename: found.filename, importMap });
        const url = createModuleUrl(result.code);
        modules.set(found.filename, url);
        return url;
      };
      const rewrites: Record<string, string> = {};
      for (const specifier of localSpecifiers) rewrites[specifier] = await compileModule(relativeUi4aPath(specifier, ui4aPath(filename!)), [filename!]);
      return { importMap: await resolveBare(source), rewrite: (code) => rewriteImportSpecifiers(code, rewrites) };
    },
    dispose() { disposed = true; for (const url of urls) (options.revokeModuleUrl ?? URL.revokeObjectURL)(url); urls.clear(); },
  };
}
