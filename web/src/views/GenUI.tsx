import { useEffect, useRef, useState } from 'react';
import { streamOpenAI } from '../lib/sse';
import { useToast } from '../components/Toast';
import { GenuiPreview } from '../components/GenuiPreview';

type Config = { macaron: { base: string; model: string } };

export function GenUI() {
  const [prompt, setPrompt] = useState('');
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const [meta, setMeta] = useState('');
  const [running, setRunning] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const codeRef = useRef<HTMLPreElement | null>(null);
  const toast = useToast();

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  // Extract the streamed `code` string from accumulated tool-call JSON args.
  // The args arrive as JSON like `{"code":"import ..."}`, but may be incomplete
  // during streaming, so we tolerate a missing closing quote/brace.
  const extractFromToolArgs = (raw: string): string => {
    // First try a strict JSON.parse — works once the stream is complete.
    try {
      const obj = JSON.parse(raw);
      if (typeof obj?.code === 'string') return obj.code;
    } catch { /* fall through to streaming regex */ }
    const m = /"code"\s*:\s*"((?:\\.|[^"\\])*)/.exec(raw);
    if (!m) return '';
    // Manual unescape covering common JSON string escapes including \uXXXX.
    return m[1]
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\\\/g, '\\');
  };

  const generate = async () => {
    if (!prompt.trim()) return toast('Type a prompt first');
    setCode('');
    setDone(false);
    setMeta('streaming…');
    setRunning(true);
    abortRef.current = new AbortController();
    const t0 = performance.now();
    let buf = '';
    let toolArgs = '';
    let thinking = 0;
    let mode: 'content' | 'tool' | null = null;
    await streamOpenAI(
      '/api/genui',
      { prompt },
      {
        signal: abortRef.current.signal,
        onReasoning: (t) => {
          thinking += t.length;
          setMeta(`thinking… ${thinking} B`);
        },
        onToolArgs: (t) => {
          mode = 'tool';
          toolArgs += t;
          const code = extractFromToolArgs(toolArgs);
          if (code) {
            setCode(code);
            setMeta(`display_tsx · ${code.length} B`);
            requestAnimationFrame(() => {
              if (codeRef.current) codeRef.current.scrollTop = codeRef.current.scrollHeight;
            });
          } else {
            setMeta(`display_tsx · ${toolArgs.length} B args`);
          }
        },
        onDelta: (t) => {
          if (mode === 'tool') return; // ignore stray content once we're in tool mode
          mode = 'content';
          buf += t;
          setCode(buf);
          setMeta(`content stream · ${buf.length} B`);
          requestAnimationFrame(() => {
            if (codeRef.current) codeRef.current.scrollTop = codeRef.current.scrollHeight;
          });
        },
        onError: (e) => toast(`error: ${e}`),
        onDone: () => {
          const dt = ((performance.now() - t0) / 1000).toFixed(1);
          const finalCode = mode === 'tool' ? extractFromToolArgs(toolArgs) : buf;
          // Push the clean final code one more time so the preview sees a
          // fully-parsed copy (overrides any incomplete partial pushes).
          setCode(finalCode);
          // eslint-disable-next-line no-console
          console.log('[GenUI done]', {
            mode,
            rawArgs: toolArgs.length,
            extracted: finalCode.length,
            head: JSON.stringify(finalCode.slice(0, 200)),
            charCodes: Array.from(finalCode.slice(0, 30)).map((c) => c.charCodeAt(0)).join(','),
          });
          setMeta(`done · ${dt}s · ${finalCode.length} B · ${thinking} B thinking · ${mode || '—'} mode`);
          setDone(true);
          setRunning(false);
        },
      },
    );
  };

  const stop = () => {
    abortRef.current?.abort();
    setMeta('stopped');
    setRunning(false);
  };

  const reset = () => {
    setCode('');
    setMeta('');
    setPrompt('');
  };

  return (
    <section className="view genui-view">
      <header>
        <h1>GenUI Builder</h1>
        <p>
          Stream TSX from Macaron and render it progressively. The preview re-mounts on every delta — incomplete code keeps the last good frame, so you see the UI <em>emerge</em>.
        </p>
        {config && (
          <div className="genui-modelinfo">
            <span className="genui-modelchip">model · {config.macaron.model}</span>
            <span className="genui-modelendpoint" title={config.macaron.base}>{new URL(config.macaron.base).host}</span>
          </div>
        )}
      </header>
      <div className="genui-prompt">
        <textarea
          rows={3}
          placeholder="Describe the UI you want…  e.g. 'A bento dashboard summarising today's flight itinerary with 3 metric cards and a small line chart.'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="row">
          <button className="primary" onClick={generate} disabled={running}>Generate</button>
          <button className="ghost" onClick={stop} disabled={!running}>Stop</button>
          <button className="ghost" onClick={reset} disabled={running}>Clear</button>
          <span className="meta">{meta}</span>
        </div>
      </div>
      <div className="genui-split">
        <div className="code-pane">
          <div className="pane-head">
            App.tsx<span className="badge">{code.length} B</span>
          </div>
          <pre className="code" ref={codeRef}>{code}</pre>
        </div>
        <div className="preview-pane">
          <div className="pane-head">
            <span>Live preview</span>
            <span className="badge">partial-react · inline</span>
          </div>
          <div className="preview-frame">
            <GenuiPreview code={code} done={done} />
          </div>
        </div>
      </div>
    </section>
  );
}
