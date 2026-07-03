// Server-side GenUI diagnostics for render_ui. Vendored from macaron-genui-demo's standalone
// check/lint path: TS semantic diagnostics over Claude's TSX, with $macaron/ui resolved to the
// REAL vendored source via compilerOptions.paths — so facade misuse (bad props, missing exports)
// surfaces with the actual valid types, not degraded to `any`. No npm dep beyond `typescript`
// + the vendored typeCheckService/diagnostics in ./genui-check-vendored.
import ts from "typescript";
import { WEB_ROOT } from "../config.js";
import { createCheckResult, type GenUICheckResult, type GenUIDiagnostic } from "./genui-check-vendored/diagnostics.js";
import { createTypeCheckService, DEFAULT_APP_FILENAME, DEFAULT_MAX_REPORTED, diagnosticMessage, type TypeCheckService } from "./genui-check-vendored/typeCheckService.js";

// Facade -> vendored source on disk, relative to WEB_ROOT (the tsconfig dir). Must stay in sync
// with the browser's import map (BASE_IMPORTS in web/src/macaron-vendor/StaticGenUIRenderer.tsx):
// a facade listed here but absent there would pass the check yet fail to render — which is why
// $macaron/ui/katex is NOT mapped despite the vendored source existing (no katex shim in the
// browser). Bare npm specifiers the browser shims (motion, framer-motion) need no entry: TS
// resolves them through web/node_modules.
const FACADE_PATHS: Record<string, string[]> = {
  "$macaron/ui": ["./src/macaron-vendor/macaron/source.tsx"],
  "$macaron/ui/charts": ["./src/macaron-vendor/genui/charts.tsx"],
  "lucide-react": ["./src/macaron-vendor/genui/lucide-react.tsx"],
  "@/components/ui/*": ["./src/macaron-vendor/components/ui/*"],
  "@/lib/*": ["./src/macaron-vendor/lib/*"],
  "@/*": ["./src/macaron-vendor/*"],
};

const compilerOptions: ts.CompilerOptions = {
  noEmit: true, strict: true, skipLibCheck: true,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react",
  allowSyntheticDefaultImports: true, esModuleInterop: true, types: ["react", "react-dom"], paths: FACADE_PATHS,
};

const toDiag = (d: ts.Diagnostic): GenUIDiagnostic => {
  const message = diagnosticMessage(ts, d);
  if (!d.file || d.start === undefined) return { message };
  const s = d.file.getLineAndCharacterOfPosition(d.start);
  return { message, startLineNumber: s.line + 1, startColumn: s.character + 1 };
};

// LanguageService is expensive to build; one shared service handles every render_ui call.
let service: TypeCheckService | undefined;

// Syntactic (unclosed JSX, stray tokens — the `lint` pass) + semantic (types, missing exports —
// the `check` pass) error diagnostics, folded into one bag. Empty code is a runtime diagnostic,
// not a TS one. `ok:false` diagnostics go into the render_ui tool_result for in-turn self-repair.
export const checkGenUI = (code: string): GenUICheckResult => {
  if (!code.trim()) return createCheckResult({ runtime: [{ message: "render_ui received empty TSX code." }] });
  const svc = (service ??= createTypeCheckService(ts, { root: WEB_ROOT, filename: DEFAULT_APP_FILENAME, compilerOptions }));
  svc.appSource = code;
  svc.appVersion += 1;
  const all = [...svc.service.getSyntacticDiagnostics(svc.appFile), ...svc.service.getSemanticDiagnostics(svc.appFile)];
  const typescript = all.filter((d) => d.category === ts.DiagnosticCategory.Error).slice(0, DEFAULT_MAX_REPORTED).map(toDiag);
  return createCheckResult({ typescript });
};
