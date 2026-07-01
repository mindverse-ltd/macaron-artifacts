import { createElement, type ComponentType, type ReactNode } from "react";

export type GeneratedFunctionComponent = (props: Record<string, unknown>) => ReactNode | Promise<ReactNode>;
export type GeneratedComponent = ComponentType<Record<string, unknown>> | GeneratedFunctionComponent;
export type GeneratedComponentSlot = { Component: GeneratedFunctionComponent; current: () => unknown; lastGood: () => unknown; setCurrent: (component: unknown) => void; markRendered: (component?: unknown) => void; restoreLastGood: () => boolean; clear: () => void };
const isClassComponent = (component: unknown) => typeof component === "function" && Boolean((component as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent);

export function createGeneratedComponentSlot(): GeneratedComponentSlot {
  const currentRef = { current: null as unknown };
  const lastGoodRef = { current: null as unknown };
  const Component = (props: Record<string, unknown>) => {
    const Current = currentRef.current;
    if (!Current) return null;
    // Function components are invoked inside this stable wrapper so React keeps their hooks on the wrapper fiber.
    if (typeof Current === "function" && !isClassComponent(Current)) return (Current as (props: Record<string, unknown>) => ReactNode | Promise<ReactNode>)(props);
    return createElement(Current as never, props);
  };
  return {
    Component,
    current: () => currentRef.current,
    lastGood: () => lastGoodRef.current,
    setCurrent(component) {
      currentRef.current = component;
    },
    markRendered(component = currentRef.current) {
      if (component) lastGoodRef.current = component;
    },
    restoreLastGood() {
      if (!lastGoodRef.current) return false;
      currentRef.current = lastGoodRef.current;
      return true;
    },
    clear() {
      currentRef.current = null;
      lastGoodRef.current = null;
    },
  };
}
