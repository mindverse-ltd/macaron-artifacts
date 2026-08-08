import { useRef } from 'react';
import StaticGenUIRenderer from '../macaron-vendor/StaticGenUIRenderer';
import { track } from '../lib/telemetry';
import { redactMessage } from '@macaron/shared';

// Thin wrapper around the vendored Macaron StaticGenUIRenderer.
// The full streaming/partial/import-map logic lives there (580 lines that we'd
// otherwise have to re-implement). All we do is pass the streamed code and a
// `streaming` flag while generation is in progress.

export function GenuiPreview({ code, done, engine }: { code: string; done?: boolean; engine: string }) {
  // The renderer re-fires onRendered for every streamed frame; the funnel counts
  // widgets, not frames, so only the first one pairs with render_ui_called.
  const reported = useRef(false);
  return (
    <div className="genui-host">
      <StaticGenUIRenderer
        code={code}
        active={Boolean(code)}
        streaming={!done && Boolean(code)}
        preserveStateOnUpdate={!done}
        flushMode="immediate"
        className="genui-renderer macaron-genui-scope"
        onRendered={(rendered) => {
          if (reported.current) return;
          reported.current = true;
          track('render_ui_rendered', { engine, codeLen: rendered.length });
        }}
        onError={(err, phase) => {
          track('render_ui_failed', { engine, phase, message: redactMessage(err.message) });
          // eslint-disable-next-line no-console
          console.warn('[GenuiPreview]', phase, err);
        }}
      />
    </div>
  );
}
