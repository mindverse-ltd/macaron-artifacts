// Server-side GenUI diagnostics for render_ui. The shared GenUI linter owns compile, strict syntax,
// and UnoCSS diagnostics; this host adds TS semantic diagnostics over Claude's TSX, with
// $ui4a/ui resolved to the shared six-component source via compilerOptions.paths — so facade misuse
// (bad props, missing exports) surfaces with the actual valid types, not degraded to `any`. The
// LanguageService scaffolding + bag formatting come from @genui/diagnostics, so every surface uses
// the same diagnostic shape and formatter.
import { existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createCheckResult, hasErrorDiagnostic, type GenUICheckResult, type GenUIDiagnostic } from "@genui/diagnostics";
import { createTypeCheckService, DEFAULT_APP_FILENAME, DEFAULT_MAX_REPORTED, diagnosticMessage, type TypeCheckService } from "@genui/diagnostics/type-check";
import { collectGenUILintDiagnostics } from "@genui/diagnostics/lint";
import { WEB_ROOT } from "../config.js";
import { loadGenUIUnocssToolkit } from "./genui-unocss.js";

// Both UI names resolve to the exact six components registered by the browser. Bare packages
// (Headless UI, Recharts, Lucide) retain their real types through web/node_modules; removed
// $macaron/ui submodules are deliberately unmapped so unsupported imports are rejected.
// `framer-motion` -> motion/react: the browser shim serves framer-motion and motion from one API
// (motion v12 is framer-motion renamed), but only `motion` is in web/node_modules, so alias
// framer-motion onto motion/react's types. (motion's .d.ts re-exports framer-motion, so
// AnimatePresence etc. degrade the same way they do for a native `motion/react` import — matching
// the browser shim's behavior rather than emitting a false TS2307.)
const FACADE_PATHS: Record<string, string[]> = {
  "$ui4a/ui": ["../artifacts/src/web/components/ui4a-ui.tsx"],
  "$macaron/ui": ["../artifacts/src/web/components/ui4a-ui.tsx"],
  "framer-motion": ["./node_modules/motion/react"],
};

const compilerOptions: ts.CompilerOptions = {
  noEmit: true, strict: true, skipLibCheck: true,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react",
  esModuleInterop: true, types: ["react", "react-dom"], paths: FACADE_PATHS,
};

// The tool description permits esm.sh/http URL imports for tiny React-free helpers, and the
// browser fetches them natively — but moduleResolution: Bundler can't resolve URL specifiers.
// Ambient-declare them as `any` so the check doesn't TS2307 code the browser renders fine.
// $macaron/chat is a runtime shim (.mjs, no .tsx source to map via FACADE_PATHS), so declare
// its types ambiently — user TSX importing sendUserMessage gets real signature checking
// instead of a TS2307.
// NOTE: this file must stay a SCRIPT (no top-level import/export) — inside a module file
// `declare module "x"` becomes an augmentation of an existing module instead of creating
// one, and the TS2307 comes back. The runtime shim also installs sendUserMessage on
// window, so a top-level (script-scoped) `interface Window` merge covers TSX that writes
// `window.sendUserMessage(...)` instead of the preferred import — no `declare global`
// wrapper (which would require module-ifying the file) needed.
const AMBIENT_DECLARATIONS =
  `declare module "https://*";\ndeclare module "http://*";\n` +
  `declare module "$macaron/chat" {\n  export function sendUserMessage(prompt: string): void;\n` +
  `  export function useAutoSend(prompt: string, seconds?: number): number | null;\n}\n` +
  `interface Window {\n  sendUserMessage(prompt: string): void;\n}\n`;

const toDiag = (d: ts.Diagnostic): GenUIDiagnostic => {
  const message = diagnosticMessage(ts, d);
  if (!d.file || d.start === undefined) return { message };
  const s = d.file.getLineAndCharacterOfPosition(d.start);
  return { message, startLineNumber: s.line + 1, startColumn: s.character + 1 };
};

// LanguageService is expensive to build; one shared service handles every render_ui call. The
// `serviceUnavailable` latch only disables host semantic checks (e.g. when a published install has
// no shared component source). Shared compile/syntax/UnoCSS lint remains active in that state.
let service: TypeCheckService | undefined;
let serviceUnavailable = false;

const collectSemanticDiagnostics = (code: string): GenUIDiagnostic[] => {
  if (serviceUnavailable) return [];
  try {
    if (!service) {
      if (!existsSync(path.resolve(WEB_ROOT, FACADE_PATHS["$ui4a/ui"]![0]!))) {
        serviceUnavailable = true;
        return [];
      }
      service = createTypeCheckService(ts, { root: WEB_ROOT, filename: DEFAULT_APP_FILENAME, compilerOptions, ambient: AMBIENT_DECLARATIONS });
    }
    const svc = service;
    svc.appSource = code;
    svc.appVersion += 1;
    return svc.service
      .getSemanticDiagnostics(svc.appFile)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .slice(0, DEFAULT_MAX_REPORTED)
      .map(toDiag);
  } catch {
    serviceUnavailable = true;
    service = undefined;
    return [];
  }
};

// Lint and semantic checks start together. If lint finds a hard source error, prefer its precise
// diagnostic over semantic cascades; otherwise merge the host-specific semantic results into the bag.
export const checkGenUI = async (code: string): Promise<GenUICheckResult> => {
  if (!code.trim()) return createCheckResult({ runtime: [{ message: "render_ui received empty TSX code." }] });
  const [lint, typescript] = await Promise.all([
    collectGenUILintDiagnostics(code, { loadUnocssToolkit: loadGenUIUnocssToolkit }).catch((error: unknown) => ({
      runtime: [{ severity: "error" as const, message: `GenUI lint failed: ${error instanceof Error ? error.message : String(error)}` }],
    })),
    Promise.resolve(collectSemanticDiagnostics(code)),
  ]);
  return createCheckResult(hasErrorDiagnostic(lint) ? lint : { ...lint, typescript });
};
