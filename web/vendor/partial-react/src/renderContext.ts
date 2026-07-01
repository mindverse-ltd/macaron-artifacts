import { createContext, useContext, type Context } from "react";

export type GenUIRenderContextValue = { rendererScope: string; streamingPartialFrame: boolean; nextStreamingRenderKey?: () => string };
const defaultRendererScope = "default";
const renderContextValues = new Map<string, { complete: GenUIRenderContextValue; streaming: GenUIRenderContextValue }>();
const getRenderContextValues = (rendererScope: string) => {
  const cached = renderContextValues.get(rendererScope);
  if (cached) return cached;
  const values = { complete: Object.freeze({ rendererScope, streamingPartialFrame: false }), streaming: Object.freeze({ rendererScope, streamingPartialFrame: true }) };
  renderContextValues.set(rendererScope, values);
  return values;
};
const completeRenderContextValue = getRenderContextValues(defaultRendererScope).complete;

const renderContextKey = Symbol.for("@macaron/genui-runtime:render-context");
const globalRenderContext = globalThis as typeof globalThis & { [renderContextKey]?: Context<GenUIRenderContextValue> };

export const getGenUIRenderContextValue = (streamingPartialFrame: boolean, rendererScope = defaultRendererScope, nextStreamingRenderKey?: () => string): GenUIRenderContextValue => {
  if (nextStreamingRenderKey) return { rendererScope, streamingPartialFrame, nextStreamingRenderKey };
  const values = getRenderContextValues(rendererScope);
  return streamingPartialFrame ? values.streaming : values.complete;
};
// Production chunks can load separate copies of this module; the global symbol keeps charts and the renderer on one Context.
export const GenUIRenderContext = (globalRenderContext[renderContextKey] ??= createContext<GenUIRenderContextValue>(completeRenderContextValue));
export const useGenUIRenderContext = () => useContext(GenUIRenderContext);
