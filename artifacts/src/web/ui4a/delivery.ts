import type { RendererImportMap } from "partial-react/import-map";
import { importSignature, type ImportRequest, type PreparedImports } from "./imports";

export type SurfaceFrame = ImportRequest & { streaming: boolean };
export type RendererPort = { pushCode: (delta: string) => void; render: (source: string) => void; finish: (source: string) => void; clear: (options?: { preserveVisualState: boolean }) => void; setImportMap: (map: RendererImportMap) => unknown };

export function deliverFrame(renderer: RendererPort, frame: SurfaceFrame, previous: { source: string; streaming: boolean } | null, force = false): boolean {
  if (!frame.streaming) {
    // Always finish a streaming buffer, even when its bytes did not change: final syntax errors and render context must settle.
    if (previous?.streaming) renderer.finish(frame.source);
    else if (force || frame.source !== previous?.source) renderer.render(frame.source);
    else return false;
    return true;
  }
  if (!force && previous && frame.source.startsWith(previous.source)) {
    const delta = frame.source.slice(previous.source.length);
    if (!delta) return false;
    renderer.pushCode(delta);
  } else {
    if (previous) renderer.clear({ preserveVisualState: true });
    renderer.pushCode(frame.source);
  }
  return true;
}

/** Import resolution can finish after many more chunks; only the latest map may deliver, and it must deliver the latest buffer. */
export class SurfaceDelivery {
  private latest: SurfaceFrame | null = null;
  private delivered: SurfaceFrame | null = null;
  private prepared: PreparedImports | null = null;
  private signature: string | null = null;
  private epoch = 0;
  private disposed = false;
  private resolutionError: Error | null = null;

  constructor(private renderer: RendererPort, private resolve: (request: ImportRequest) => Promise<PreparedImports>, private onError: (error: Error) => void) {}

  update(frame: SurfaceFrame) {
    if (this.disposed) return;
    this.latest = frame;
    if (!frame.source.trim()) {
      this.epoch++;
      this.signature = null;
      this.prepared = null;
      this.delivered = null;
      this.renderer.clear();
      return;
    }
    const signature = importSignature(frame);
    if (signature === this.signature) {
      if (this.prepared) this.deliver();
      else if (!frame.streaming && this.resolutionError) this.onError(this.resolutionError);
      return;
    }
    this.signature = signature;
    this.prepared = null;
    this.resolutionError = null;
    const epoch = ++this.epoch;
    void this.resolve(frame).then((prepared) => {
      if (this.disposed || epoch !== this.epoch) return;
      this.prepared = prepared;
      this.renderer.setImportMap(prepared.importMap);
      this.deliver(true);
    }, (error: unknown) => {
      if (this.disposed || epoch !== this.epoch) return;
      this.resolutionError = error instanceof Error ? error : new Error(String(error));
      if (!this.latest?.streaming) this.onError(this.resolutionError);
    });
  }

  private deliver(force = false) {
    if (!this.latest || !this.prepared) return;
    const frame = { ...this.latest, source: this.prepared.rewrite(this.latest.source) };
    if (deliverFrame(this.renderer, frame, this.delivered, force)) this.delivered = frame;
  }

  dispose() { this.disposed = true; this.epoch++; }
}
