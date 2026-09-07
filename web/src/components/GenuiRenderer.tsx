import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { GenUIRenderer, type GenUIRendererFlushMode, type GenUIRenderPhase } from 'partial-react';
import { SurfaceDelivery } from '../../../artifacts/src/web/ui4a/delivery';
import { createGenuiImports } from '../lib/genui-imports';

type Props = { code: string; active?: boolean; streaming?: boolean; preserveStateOnUpdate?: boolean; flushMode?: GenUIRendererFlushMode; className?: string; onRendered?: (code: string) => void; onError?: (error: Error, phase: GenUIRenderPhase) => void };

/** Only the legacy host bridge differs; rendering and frame delivery use the shared implementation. */
export function GenuiRenderer({ code, active = true, streaming = false, preserveStateOnUpdate = true, flushMode = 'immediate', className, onRendered, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<GenUIRenderer | null>(null);
  const delivery = useRef<SurfaceDelivery | null>(null);
  const latest = useRef({ source: code, streaming });
  const rendered = useEffectEvent((source: string) => { if (source === latest.current.source) onRendered?.(source); });
  const failed = useEffectEvent((error: Error, phase: GenUIRenderPhase) => { if (!latest.current.streaming) onError?.(error, phase); });

  useLayoutEffect(() => {
    latest.current = { source: code, streaming };
    renderer.current?.setPreserveStateOnUpdate(preserveStateOnUpdate);
    renderer.current?.setFlushMode(flushMode);
    if (active) delivery.current?.update(latest.current);
  }, [code, streaming, preserveStateOnUpdate, flushMode, active]);

  useEffect(() => {
    const target = host.current;
    if (!target || !active) return;
    let disposed = false;
    void GenUIRenderer.create(target, {
      preserveStateOnUpdate, flushMode,
      callbacks: { onRendered: (_component, source) => { if (!disposed && source !== undefined) rendered(source); }, onError: (error, phase) => { if (!disposed) failed(error, phase); } },
    }).then(created => {
      if (disposed) { created.detach(); return; }
      renderer.current = created;
      delivery.current = new SurfaceDelivery(created, createGenuiImports(), error => failed(error, 'compile'));
      delivery.current.update(latest.current);
    }).catch(error => { if (!disposed) failed(error, 'compile'); });
    return () => {
      disposed = true; delivery.current?.dispose(); delivery.current = null;
      const current = renderer.current; renderer.current = null;
      queueMicrotask(() => current?.detach());
    };
  }, [active]);

  return <div className={className}><div ref={host} data-genui-render-host className="h-full w-full" /></div>;
}
