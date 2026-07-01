export type RendererImportMap = { imports?: Record<string, string>; scopes?: Record<string, Record<string, string>>; styles?: string[] };

// A provider contributes import-map entries. `base` providers always run; `fallback` providers only run when earlier
// providers left some required specifier unresolved, and only see (and should answer for) those `missing` specifiers.
export type ImportMapProviderContext = { code: string; missing: string[] };
export type ImportMapProvider = { kind?: "base" | "fallback"; prefetch?: () => Promise<unknown> | void; resolve: (context: ImportMapProviderContext) => RendererImportMap | Promise<RendererImportMap> };

const ESM_SH_VERSION_OVERRIDES = { "@number-flow/react": "0.6.0" } as const;
const DEFAULT_ESM_SH_EXTERNALS = ["react", "react-dom", "scheduler"] as const;
const IDENTIFIER_CHAR_PATTERN = /[\w$]/;
const REGEX_PREFIX_WORDS = new Set(["return", "throw", "case", "delete", "typeof", "void", "new", "in", "of", "await", "yield"]);
const LOCAL_EXPORT_KEYWORDS = ["abstract", "async", "class", "const", "declare", "default", "enum", "function", "interface", "let", "namespace", "var"];

export const isBareModuleSpecifier = (specifier: string) => !specifier.startsWith(".") && !specifier.startsWith("/") && !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(specifier);
export const getBarePackageName = (specifier: string) => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0] || specifier);
// Shared #1178 contract: /src/… and /node_modules/… targets are root-relative disk paths each engine rebases against
// its own root (dev: Vite's resolved root; build: cwd). Single-sourced so a new local prefix lands in both engines.
export const isLocalRootRelativeTarget = (target: string) => target.startsWith("/src/") || target.startsWith("/node_modules/");
const canUseEsmShFallback = (specifier: string) => isBareModuleSpecifier(specifier) && !specifier.startsWith("@/");

const isKeywordAt = (code: string, index: number, keyword: string) => code.startsWith(keyword, index) && !IDENTIFIER_CHAR_PATTERN.test(code[index - 1] ?? "") && !IDENTIFIER_CHAR_PATTERN.test(code[index + keyword.length] ?? "");

const skipLineComment = (code: string, index: number) => {
  const newlineIndex = code.indexOf("\n", index + 2);
  return newlineIndex === -1 ? code.length : newlineIndex;
};

const skipBlockComment = (code: string, index: number) => {
  const closeIndex = code.indexOf("*/", index + 2);
  return closeIndex === -1 ? code.length : closeIndex + 2;
};

const skipWhitespaceAndComments = (code: string, index: number) => {
  while (index < code.length) {
    if (/\s/.test(code[index])) {
      index += 1;
      continue;
    }
    if (code[index] === "/" && code[index + 1] === "/") {
      index = skipLineComment(code, index);
      continue;
    }
    if (code[index] === "/" && code[index + 1] === "*") {
      index = skipBlockComment(code, index);
      continue;
    }
    break;
  }
  return index;
};

const readStringLiteral = (code: string, index: number) => {
  const quote = code[index];
  if (quote !== '"' && quote !== "'") return null;
  let value = "";
  index += 1;
  while (index < code.length) {
    const char = code[index];
    if (char === "\\") {
      value += code.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === quote) return { value, end: index + 1 };
    value += char;
    index += 1;
  }
  return { value, end: code.length };
};

const skipTemplateLiteral = (code: string, index: number, onExpression?: (start: number, end: number) => void) => {
  index += 1;
  while (index < code.length) {
    if (code[index] === "\\") {
      index += 2;
      continue;
    }
    if (code[index] === "`") return index + 1;
    if (code[index] === "$" && code[index + 1] === "{") {
      const expressionStart = index + 2;
      const expressionEnd = findBalancedBlockEnd(code, index + 1, "{", "}");
      onExpression?.(expressionStart, Math.max(expressionStart, expressionEnd - 1));
      index = expressionEnd;
      continue;
    }
    index += 1;
  }
  return code.length;
};

const findBalancedBlockEnd = (code: string, index: number, opener: string, closer: string) => {
  let depth = 0;
  while (index < code.length) {
    const char = code[index];
    if (char === "/" && code[index + 1] === "/") {
      index = skipLineComment(code, index);
      continue;
    }
    if (char === "/" && code[index + 1] === "*") {
      index = skipBlockComment(code, index);
      continue;
    }
    if (isLikelyRegexLiteralStart(code, index)) {
      index = skipRegexLiteral(code, index);
      continue;
    }
    if (char === '"' || char === "'") {
      index = readStringLiteral(code, index)?.end ?? index + 1;
      continue;
    }
    if (char === "`") {
      index = skipTemplateLiteral(code, index);
      continue;
    }
    if (char === opener) depth += 1;
    if (char === closer) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return code.length;
};

const isLikelyRegexLiteralStart = (code: string, index: number) => {
  if (code[index] !== "/" || code[index + 1] === "/" || code[index + 1] === "*") return false;
  let previous = index - 1;
  while (previous >= 0 && /\s/.test(code[previous])) previous -= 1;
  if (previous < 0) return true;
  const previousChar = code[previous];
  if ("([{=,:;!&|?+-*~^<>".includes(previousChar)) return true;
  if (!/[A-Za-z_$]/.test(previousChar)) return false;
  let word = "";
  for (let cursor = previous; cursor >= 0 && /[A-Za-z0-9_$]/.test(code[cursor]); cursor -= 1) word = code[cursor] + word;
  return REGEX_PREFIX_WORDS.has(word);
};

const skipRegexLiteral = (code: string, index: number) => {
  index += 1;
  let inClass = false;
  while (index < code.length) {
    const char = code[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (char === "[" && !inClass) inClass = true;
    else if (char === "]" && inClass) inClass = false;
    else if (char === "/" && !inClass) {
      while (index < code.length && /[A-Za-z]/.test(code[index])) index += 1;
      return index;
    }
  }
  return code.length;
};

const readFromSpecifier = (code: string, index: number) => {
  while (index < code.length) {
    const char = code[index];
    if (char === ";") return null;
    if (char === "/" && code[index + 1] === "/") {
      index = skipLineComment(code, index);
      continue;
    }
    if (char === "/" && code[index + 1] === "*") {
      index = skipBlockComment(code, index);
      continue;
    }
    if (isLikelyRegexLiteralStart(code, index)) {
      index = skipRegexLiteral(code, index);
      continue;
    }
    if (char === '"' || char === "'") {
      index = readStringLiteral(code, index)?.end ?? index + 1;
      continue;
    }
    if (char === "`") {
      index = skipTemplateLiteral(code, index);
      continue;
    }
    if (isKeywordAt(code, index, "from")) {
      const literal = readStringLiteral(code, skipWhitespaceAndComments(code, index + "from".length));
      if (literal) return { specifier: literal.value, end: literal.end };
      index += "from".length;
      continue;
    }
    index += 1;
  }
  return null;
};

const readExportFromSpecifier = (code: string, index: number) => {
  let next = skipWhitespaceAndComments(code, index);
  if (isKeywordAt(code, next, "type")) next = skipWhitespaceAndComments(code, next + "type".length);
  if (code[next] === "*" || code[next] === "{") return readFromSpecifier(code, next);
  for (const keyword of LOCAL_EXPORT_KEYWORDS) if (isKeywordAt(code, next, keyword)) return null;
  return readFromSpecifier(code, next);
};

const collectModuleSpecifiers = (code: string, specifiers: Set<string>, includeSpecifier: (specifier: string) => boolean, start = 0, end = code.length) => {
  for (let index = start; index < end; index += 1) {
    const char = code[index];
    if (char === "/" && code[index + 1] === "/") {
      index = skipLineComment(code, index);
      continue;
    }
    if (char === "/" && code[index + 1] === "*") {
      index = skipBlockComment(code, index);
      continue;
    }
    if (isLikelyRegexLiteralStart(code, index)) {
      index = skipRegexLiteral(code, index);
      continue;
    }
    if (char === '"' || char === "'") {
      index = readStringLiteral(code, index)?.end ?? index;
      continue;
    }
    if (char === "`") {
      index = skipTemplateLiteral(code, index, (expressionStart, expressionEnd) => collectModuleSpecifiers(code, specifiers, includeSpecifier, expressionStart, expressionEnd));
      continue;
    }
    if (isKeywordAt(code, index, "import")) {
      const afterImport = skipWhitespaceAndComments(code, index + "import".length);
      if (code[afterImport] === ".") {
        index = afterImport;
        continue;
      }
      if (code[afterImport] === "(") {
        const literal = readStringLiteral(code, skipWhitespaceAndComments(code, afterImport + 1));
        if (literal?.value && includeSpecifier(literal.value)) specifiers.add(literal.value);
        index = literal?.end ?? afterImport;
        continue;
      }
      const sideEffect = readStringLiteral(code, afterImport);
      const from = sideEffect ? { specifier: sideEffect.value, end: sideEffect.end } : readFromSpecifier(code, afterImport);
      if (from?.specifier && includeSpecifier(from.specifier)) specifiers.add(from.specifier);
      index = from?.end ?? afterImport;
      continue;
    }
    if (isKeywordAt(code, index, "export")) {
      const from = readExportFromSpecifier(code, index + "export".length);
      if (from?.specifier && includeSpecifier(from.specifier)) specifiers.add(from.specifier);
      index = from?.end ?? index;
    }
  }
};

export function extractBareModuleSpecifiers(code: string) {
  const specifiers = new Set<string>();
  collectModuleSpecifiers(code, specifiers, isBareModuleSpecifier);
  return specifiers;
}

export function extractModuleSpecifiers(code: string) {
  const specifiers = new Set<string>();
  collectModuleSpecifiers(code, specifiers, () => true);
  return specifiers;
}

export function hasImportMapEntry(imports: Record<string, string> | Set<string> | Map<string, string>, specifier: string) {
  const keys = imports instanceof Set ? imports : imports instanceof Map ? new Set(imports.keys()) : new Set(Object.keys(imports));
  if (keys.has(specifier)) return true;
  for (const key of keys) if (key.endsWith("/") && specifier.startsWith(key)) return true;
  return false;
}

export function toEsmShImportUrl(specifier: string, external: readonly string[] = DEFAULT_ESM_SH_EXTERNALS) {
  if (!canUseEsmShFallback(specifier)) throw new Error(`Cannot create an esm.sh fallback for ${specifier}`);
  const packageName = getBarePackageName(specifier);
  const version = ESM_SH_VERSION_OVERRIDES[packageName as keyof typeof ESM_SH_VERSION_OVERRIDES];
  const versionedSpecifier = version ? `${packageName}@${version}${specifier.slice(packageName.length)}` : specifier;
  const separator = versionedSpecifier.includes("?") ? "&" : "?";
  const externalParam = external.length ? `&external=${external.join(",")}` : "";
  return `https://esm.sh/${versionedSpecifier}${separator}bundle&target=es2022${externalParam}`;
}

export function prepareRendererImportMap(map: RendererImportMap | null | undefined, baseUrl = typeof location === "undefined" ? undefined : location.href) {
  const resolveTarget = (target: string) => (baseUrl ? new URL(target, baseUrl).href : target);
  const resolveEntries = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).map(([specifier, target]) => [specifier, resolveTarget(target)]));
  const imports = resolveEntries(map?.imports ?? {});
  const styles = map?.styles?.map(resolveTarget);
  const scopes = map?.scopes && Object.fromEntries(Object.entries(map.scopes).map(([scope, entries]) => [scope, resolveEntries(entries)]));
  return { imports, ...(scopes ? { scopes } : {}), ...(styles?.length ? { styles } : {}) };
}

export function literalImportMap(map: RendererImportMap): ImportMapProvider {
  return { resolve: () => map };
}

// Loads a remote/JSON import map once. `prefetch()` and `resolve()` share the in-flight promise so an idle-time
// prefetch and a later render both reuse the same fetch instead of hitting the network twice.
export function urlImportMap(source: string, options?: { kind?: ImportMapProvider["kind"]; fetch?: (source: string) => Promise<Pick<Response, "ok" | "status" | "statusText" | "json">> }): ImportMapProvider {
  const fetcher = options?.fetch ?? fetch;
  let loadPromise: Promise<RendererImportMap> | undefined;
  const load = () =>
    (loadPromise ??= (async () => {
      const response = await fetcher(source);
      if (!response.ok) throw new Error(`Failed to load import map ${source}: ${response.status} ${response.statusText}`);
      return prepareRendererImportMap((await response.json()) as RendererImportMap, source);
    })());
  return { kind: options?.kind ?? "base", prefetch: load, resolve: load };
}

// Node-only: resolve `packageName`'s package.json#genui.importMap into a provider. Relative targets (./dist/…) are
// rebased to absolute disk paths so Vite/Rollup can load them; absolute paths and URLs pass through. Throws if the
// package declares no genui.importMap. Resolution is from the caller's cwd (where the user installed the package),
// not this file's location — so `bunx @genui/cli -i @macaron/ui` finds the user's package, not the CLI's. node:
// imports stay inside resolve() so this module remains browser-bundleable.
export function packageImportMap(packageName: string, options?: { resolve?: (name: string) => string }): ImportMapProvider {
  return {
    resolve: async () => {
      const [{ createRequire }, { readFile }, { dirname, resolve: resolvePath }] = await Promise.all([import("node:module"), import("node:fs/promises"), import("node:path")]);
      const resolveName = options?.resolve ?? createRequire(resolvePath("package.json")).resolve;
      const manifestPath = resolveName(`${packageName}/package.json`);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { genui?: { importMap?: RendererImportMap } };
      const importMap = manifest.genui?.importMap;
      if (!importMap) throw new Error(`${packageName} has no package.json#genui.importMap — add it to declare the GenUI importmap contract`);
      const packageDir = dirname(manifestPath);
      const rebase = (target: string) => (target.startsWith(".") ? resolvePath(packageDir, target) : target);
      return { imports: Object.fromEntries(Object.entries(importMap.imports ?? {}).map(([specifier, target]) => [specifier, rebase(target)])), styles: importMap.styles?.map(rebase) };
    },
  };
}

// esm.sh fallback only answers for `missing` specifiers, so the resolver can merge its output without re-checking
// coverage. In dev, locally installed packages are preferred so peer deps like React stay on the preview's runtime.
export function esmShFallback(options?: { external?: readonly string[]; hasLocalPackage?: (packageName: string) => Promise<boolean> }): ImportMapProvider {
  return {
    kind: "fallback",
    resolve: async ({ missing }) => {
      const entries = await Promise.all(
        missing.filter(canUseEsmShFallback).map(async (specifier) => {
          const isLocal = await options?.hasLocalPackage?.(getBarePackageName(specifier));
          return [specifier, isLocal ? `/node_modules/${specifier}` : toEsmShImportUrl(specifier, options?.external)] as const;
        }),
      );
      return { imports: Object.fromEntries(entries) };
    },
  };
}

export function createImportMapResolver(providers: ImportMapProvider[]) {
  return {
    // Idle/build-time warmup only touches base providers. Fallback providers stay lazy until resolve() has scanned the
    // TSX for missing specifiers, so prefetching them would fetch remote maps the rendered code may never reference.
    prefetch: () => Promise.all(providers.filter((provider) => provider.kind !== "fallback").map((provider) => provider.prefetch?.())).then(() => undefined),
    async resolve({ code = "" }: { code?: string } = {}) {
      const required = [...extractBareModuleSpecifiers(code)];
      let imports: Record<string, string> = {};
      let scopes: RendererImportMap["scopes"];
      let styles: string[] | undefined;
      for (const provider of providers) {
        const covered = new Set(Object.keys(imports));
        const missing = required.filter((specifier) => !hasImportMapEntry(covered, specifier));
        if (provider.kind === "fallback" && missing.length === 0) continue;
        const next = await provider.resolve({ code, missing });
        imports = { ...imports, ...next.imports };
        // scopes is an advanced compat field with no producer today, so a later provider replaces an earlier one's
        // entries for the same scope key rather than deep-merging them. Revisit if two providers ever both emit scopes.
        if (next.scopes) scopes = { ...scopes, ...next.scopes };
        if (next.styles?.length) styles = [...(styles ?? []), ...next.styles];
      }
      return { imports, ...(scopes ? { scopes } : {}), ...(styles?.length ? { styles: [...new Set(styles)] } : {}) };
    },
  };
}

export async function mergeFallbackImports(imports: Record<string, string>, code: string, options?: { hasLocalPackage?: (packageName: string) => Promise<boolean> }) {
  return (await createImportMapResolver([literalImportMap({ imports }), esmShFallback(options)]).resolve({ code })).imports;
}
