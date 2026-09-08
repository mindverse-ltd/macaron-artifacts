import { GenuiRenderer } from './GenuiRenderer';
import type { Engine } from '@macaron/shared';
import { trackFailedOnce, trackRenderedOnce } from '../lib/telemetry';

export function GenuiPreview({ code, done, engine, widgetId }: { code: string; done?: boolean; engine?: Engine; widgetId?: string }) {
  return (
    <div className="genui-host">
      <GenuiRenderer
        code={code}
        active={Boolean(code)}
        streaming={!done && Boolean(code)}
        preserveStateOnUpdate={!done}
        flushMode="immediate"
        className="genui-renderer macaron-genui-scope"
        onRendered={() => { if (engine && widgetId) trackRenderedOnce(widgetId, engine); }}
        onError={(err, phase) => {
          if (done && engine && widgetId) trackFailedOnce(widgetId, engine, phase, err.message);
          // eslint-disable-next-line no-console
          console.warn('[GenuiPreview]', phase, err);
        }}
      />
    </div>
  );
}
