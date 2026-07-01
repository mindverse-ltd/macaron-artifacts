import { Component, createElement, useEffect, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createGeneratedComponentSlot, type GeneratedComponentSlot } from "./state";
import { createTsxCompiler, type TsxCompiler, type CompileResult } from "./compiler";
import { GenUIRenderContext, getGenUIRenderContextValue } from "./renderContext";
import { getGenUIHookSignature } from "./hookSignature";
import type { RendererImportMap } from "./importMap";

export type GenUIRenderPhase = "transform" | "compile" | "render";
export type GenUIRendererCallbacks = { onReady?: (component: unknown, url?: string, code?: string) => void; onRendered?: (component: unknown, code: string, serial?: number) => void; onError?: (error: Error, phase: GenUIRenderPhase) => void };
export type GenUIRendererClearOptions = { preserveVisualState?: boolean };
export type GenUIRendererFlushMode = "microtask" | "immediate";
export type GenUIRendererOptions = { importmap?: RendererImportMap; callbacks?: GenUIRendererCallbacks; compiler?: TsxCompiler; preserveStateOnUpdate?: boolean; flushMode?: GenUIRendererFlushMode };
export type GenUIRendererUpdateMode = "push" | "render";

const attachedRenderer = Symbol.for("@macaron/genui-runtime:attached-renderer");
type AttachableHost = HTMLElement & { [attachedRenderer]?: GenUIRenderer };
const normalizeError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
const COMPILED_COMPONENT_CACHE_LIMIT = 256;
let rendererScopeSerial = 0;
const createRendererScope = () => `renderer:${(rendererScopeSerial += 1).toString(36)}`;
const compiledComponentCache = new Map<string, unknown>();
const getPreserveBoundaryKey = (epoch: number) => (epoch === 0 ? "boundary" : `boundary:${epoch}`);
const rememberCompiledComponent = (code: string, component: unknown) => {
  if (compiledComponentCache.has(code)) compiledComponentCache.delete(code);
  compiledComponentCache.set(code, component);
  if (compiledComponentCache.size > COMPILED_COMPONENT_CACHE_LIMIT) {
    const oldestKey = compiledComponentCache.keys().next().value;
    if (oldestKey !== undefined) compiledComponentCache.delete(oldestKey);
  }
};

class RuntimeErrorBoundary extends Component<{ resetKey?: number; onError?: (error: Error) => void; children?: ReactNode }, { hasError: boolean; lastResetKey?: number }> {
  state = { hasError: false, lastResetKey: undefined as number | undefined };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  static getDerivedStateFromProps(props: { resetKey?: number }, state: { hasError: boolean; lastResetKey?: number }) {
    // Streaming errors bump resetKey to clear the caught state in place; recreating the boundary via `key`
    // would unmount the entire subtree below and produce visible flicker on every retry.
    if (props.resetKey !== state.lastResetKey) return { hasError: false, lastResetKey: props.resetKey };
    return null;
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  render() {
    if (this.state.hasError) return "ERROR";
    return this.props.children;
  }
}

const RenderNotify = ({ onCommit, onReady }: { onCommit?: () => void; onReady?: () => void }) => {
  useEffect(() => {
    onCommit?.();
    if (typeof document !== "undefined" && document.hidden) {
      onReady?.();
      return;
    }
    const frameId = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frameId);
  }, [onCommit, onReady]);
  return null;
};

export class GenUIRenderer {
  private callbacks: GenUIRendererCallbacks;
  private compiler: TsxCompiler;
  private compileSerial = 0;
  private currentBuffer = "";
  private compileScheduled = false;
  private compileScheduleToken = 0;
  private scheduledPartial = false;
  private scheduledSerial?: number;
  private errorEpoch = 0;
  private finished = false;
  private flushMode: GenUIRendererFlushMode;
  private importmap?: RendererImportMap;
  private lastCompiledCode = "";
  private lastGoodHookSignature = "";
  private lastHookSignature: string | null = null;
  private moduleUrl: string | null = null;
  private preserveBoundaryEpoch = 0;
  private preserveStateOnUpdate: boolean;
  private renderRound = 0;
  private rendererScope: string;
  private root: Root | null = null;
  private slot: GeneratedComponentSlot;
  private target: HTMLElement | null = null;
  private updateMode: GenUIRendererUpdateMode = "render";

  private constructor(target: HTMLElement | null | undefined, options: GenUIRendererOptions) {
    this.callbacks = options.callbacks ?? {};
    this.compiler = options.compiler ?? createTsxCompiler();
    this.flushMode = options.flushMode ?? "microtask";
    this.importmap = options.importmap;
    this.preserveStateOnUpdate = options.preserveStateOnUpdate ?? true;
    this.rendererScope = createRendererScope();
    this.slot = createGeneratedComponentSlot();
    if (target) this.attach(target);
  }

  static async create(target?: HTMLElement | null, options: GenUIRendererOptions = {}) {
    return new GenUIRenderer(target, options);
  }

  attach(target: HTMLElement) {
    const element = target as AttachableHost;
    if (element[attachedRenderer] && element[attachedRenderer] !== this) element[attachedRenderer].detach();
    if (this.target === target && this.root) {
      element[attachedRenderer] = this;
      return this;
    }
    const previous = this.target as AttachableHost | null;
    if (previous && previous[attachedRenderer] === this) delete previous[attachedRenderer];
    this.root?.unmount();
    this.target = target;
    this.root = createRoot(target);
    element[attachedRenderer] = this;
    this.renderComponent();
    return this;
  }

  detach() {
    // Bump compileSerial so any in-flight compile resolves into a no-op instead of adopting onto a dead renderer.
    this.compileSerial += 1;
    const previous = this.target as AttachableHost | null;
    if (previous && previous[attachedRenderer] === this) delete previous[attachedRenderer];
    this.root?.unmount();
    this.root = null;
    this.target = null;
    this.rendererScope = createRendererScope();
    this.revokeModuleUrl();
    return this;
  }

  setPreserveStateOnUpdate(value: boolean) {
    this.preserveStateOnUpdate = value;
    return this;
  }

  setFlushMode(value: GenUIRendererFlushMode) {
    this.flushMode = value;
    return this;
  }

  setImportMap(importmap: RendererImportMap) {
    this.importmap = importmap;
    return this;
  }

  render(code: string, serial?: number) {
    this.finished = true;
    this.currentBuffer = code;
    this.updateMode = "render";
    this.scheduleCompile(false, serial);
  }

  pushCode(code: string, serial?: number) {
    this.finished = false;
    this.currentBuffer += code;
    this.updateMode = "push";
    this.scheduleCompile(true, serial);
  }

  finish(code?: string, serial?: number) {
    this.finished = true;
    if (code !== undefined) this.currentBuffer = code;
    this.scheduleCompile(false, serial);
  }

  getCurrentBuffer() {
    return this.currentBuffer;
  }

  getUpdateMode() {
    return this.updateMode;
  }

  restoreLastGood() {
    if (!this.slot.restoreLastGood()) return false;
    this.errorEpoch += 1;
    this.renderComponent(this.slot.current(), this.currentBuffer, undefined, this.currentBuffer, this.lastGoodHookSignature);
    return true;
  }

  private buildStreamingRenderContext(streamingPartialFrame: boolean) {
    let streamingRenderKeyIndex = 0;
    return getGenUIRenderContextValue(streamingPartialFrame, this.rendererScope, () => `chart-${streamingRenderKeyIndex++}`);
  }

  private canRenderComponent(component: unknown, streamingPartialFrame: boolean) {
    const renderContext = this.buildStreamingRenderContext(streamingPartialFrame);
    const previousConsoleError = console.error;
    let firstConsoleError: string | undefined;
    let caughtError: unknown;
    try {
      // Preflight intentionally renders bad partial frames; keep React's development console noise off the debug page.
      console.error = (...args) => {
        firstConsoleError ??= args.map(String).join(" ");
      };
      renderToString(createElement(GenUIRenderContext.Provider, { value: renderContext }, createElement(component as ComponentType<Record<string, unknown>>)));
    } catch (error) {
      caughtError = error;
    } finally {
      console.error = previousConsoleError;
    }
    if (caughtError === undefined && firstConsoleError !== undefined) caughtError = new Error(firstConsoleError);
    if (caughtError === undefined) return true;
    this.callbacks.onError?.(normalizeError(caughtError), "render");
    return false;
  }

  clear(options: GenUIRendererClearOptions = {}) {
    this.compileSerial += 1;
    this.currentBuffer = "";
    // `clear` terminates the current stream; the next `pushCode`/`render` selects partial vs full mode again.
    this.finished = true;
    this.compileScheduled = false;
    this.scheduledPartial = false;
    this.scheduledSerial = undefined;
    this.compileScheduleToken += 1;
    this.lastCompiledCode = "";
    if (options.preserveVisualState) return this;
    this.lastGoodHookSignature = "";
    this.lastHookSignature = null;
    this.preserveBoundaryEpoch = 0;
    this.rendererScope = createRendererScope();
    this.slot.clear();
    this.revokeModuleUrl();
    this.root?.render(null);
    return this;
  }

  private scheduleCompile(partial: boolean, serial?: number) {
    if (this.flushMode === "immediate") {
      this.compileScheduled = false;
      this.scheduledPartial = false;
      this.scheduledSerial = undefined;
      this.compileScheduleToken += 1;
      void this.compile(partial, serial);
      return;
    }
    this.scheduledPartial = partial;
    this.scheduledSerial = serial;
    if (this.compileScheduled) return;
    this.compileScheduled = true;
    const scheduleToken = (this.compileScheduleToken += 1);
    queueMicrotask(() => {
      if (scheduleToken !== this.compileScheduleToken) return;
      const nextPartial = this.scheduledPartial;
      const nextSerial = this.scheduledSerial;
      this.compileScheduled = false;
      this.scheduledPartial = false;
      this.scheduledSerial = undefined;
      void this.compile(nextPartial, nextSerial);
    });
  }

  private async compile(partial: boolean, renderSerial?: number) {
    const serial = (this.compileSerial += 1);
    const code = this.currentBuffer;
    let result: CompileResult;
    try {
      result = await this.compiler.compile(code, { importMap: this.importmap, partial: partial && !this.finished, previousCode: this.lastCompiledCode });
    } catch (error) {
      if (serial !== this.compileSerial) return;
      this.callbacks.onError?.(normalizeError(error), "transform");
      return;
    }
    if (serial !== this.compileSerial) return;
    if (!result.changed) {
      const component = this.slot.current();
      // The final full compile can equal the last partial frame; re-render once with finished=true so the chart render
      // context settles from streaming to complete (charts key off streamingPartialFrame and would otherwise stay streaming).
      if (component && this.preserveStateOnUpdate && this.updateMode === "push" && this.finished) {
        this.renderComponent(component, code, renderSerial, result.source);
        return;
      }
      if (component) this.scheduleRenderedCallback(component, code, renderSerial, serial);
      return;
    }
    try {
      const { component, moduleUrl } = await this.importCompiledComponent(result.code);
      if (serial !== this.compileSerial) {
        if (moduleUrl) URL.revokeObjectURL(moduleUrl);
        return;
      }
      this.lastCompiledCode = result.code;
      if (moduleUrl) this.adoptModuleUrl(moduleUrl);
      else this.revokeModuleUrl();
      this.callbacks.onReady?.(component, moduleUrl, code);
      this.slot.setCurrent(component);
      this.renderComponent(component, code, renderSerial, result.source);
    } catch (error) {
      if (serial !== this.compileSerial) return;
      this.callbacks.onError?.(normalizeError(error), "compile");
    }
  }

  private async importCompiledComponent(code: string) {
    const cached = compiledComponentCache.get(code);
    if (cached) return { component: cached };
    const moduleUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    try {
      const module = (await import(/* @vite-ignore */ moduleUrl)) as { default?: unknown };
      if (!module.default) throw new Error("No default export found in compiled module.");
      rememberCompiledComponent(code, module.default);
      return { component: module.default, moduleUrl };
    } catch (error) {
      URL.revokeObjectURL(moduleUrl);
      throw error;
    }
  }

  private adoptModuleUrl(moduleUrl: string) {
    if (this.moduleUrl && this.moduleUrl !== moduleUrl) URL.revokeObjectURL(this.moduleUrl);
    this.moduleUrl = moduleUrl;
  }

  private revokeModuleUrl() {
    if (!this.moduleUrl) return;
    URL.revokeObjectURL(this.moduleUrl);
    this.moduleUrl = null;
  }

  private scheduleRenderedCallback(component: unknown, code: string, renderSerial: number | undefined, compileSerial: number) {
    const notify = () => {
      if (compileSerial === this.compileSerial) this.callbacks.onRendered?.(component, code, renderSerial);
    };
    if (typeof document !== "undefined" && document.hidden) {
      notify();
      return;
    }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(notify);
    else queueMicrotask(notify);
  }

  private renderComponent(component = this.slot.current(), renderedCode = this.currentBuffer, renderSerial?: number, sourceCode = renderedCode, hookSignature = getGenUIHookSignature(sourceCode)) {
    if (!this.root || !component) return;
    this.renderRound += 1;
    const renderedComponent = component;
    // streamingPartialFrame only drives the chart render context below (chart keys remount per partial frame). Preserve
    // stays on throughout streaming: each partial frame can have a different hook count, so the hook-signature diff in
    // the preserve branch remounts the stable wrapper whenever the layout changes, which is what would otherwise reuse
    // the wrong hook cells and violate the Rules of Hooks (React #310).
    const streamingPartialFrame = this.updateMode === "push" && !this.finished;
    const preserve = this.preserveStateOnUpdate;
    const renderedHookSignature = hookSignature;
    const lastGood = this.slot.lastGood();
    if (preserve && streamingPartialFrame && lastGood && lastGood !== renderedComponent && !this.canRenderComponent(renderedComponent, streamingPartialFrame)) {
      this.slot.restoreLastGood();
      return;
    }
    if (preserve) {
      // Preserving state across hook layout changes reuses the wrong hook cells; remount only that stable wrapper epoch.
      // lastHookSignature is null only before the first committed frame; "" is a real hookless signature, so a hookless→hooked
      // transition (the common JSX-first-then-useState stream shape) must still bump the epoch and remount (React #310).
      if (this.lastHookSignature !== null && this.lastHookSignature !== renderedHookSignature) this.preserveBoundaryEpoch += 1;
      this.lastHookSignature = renderedHookSignature;
    }
    const renderContext = this.buildStreamingRenderContext(streamingPartialFrame);
    const onRenderError = (error: Error) => {
      this.callbacks.onError?.(error, "render");
      if (!preserve) return;
      if (this.slot.lastGood() === renderedComponent || !this.restoreLastGood()) this.errorEpoch += 1;
    };
    this.root.render(
      createElement(
        RuntimeErrorBoundary,
        { key: preserve ? getPreserveBoundaryKey(this.preserveBoundaryEpoch) : `boundary:${this.renderRound}`, resetKey: this.errorEpoch, onError: onRenderError },
        createElement(GenUIRenderContext.Provider, { value: renderContext }, createElement(preserve ? this.slot.Component : (renderedComponent as ComponentType<Record<string, unknown>>), { key: "generated-component" })),
        createElement(RenderNotify, {
          key: `render-notify:${this.renderRound}`,
          onCommit: () => {
            if (this.slot.current() === renderedComponent) {
              this.slot.markRendered(renderedComponent);
              if (preserve) this.lastGoodHookSignature = renderedHookSignature;
            }
          },
          onReady: () => {
            this.callbacks.onRendered?.(renderedComponent, renderedCode, renderSerial);
          },
        }),
      ),
    );
  }
}
