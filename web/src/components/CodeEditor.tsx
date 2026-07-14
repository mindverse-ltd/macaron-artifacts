// Thin CodeMirror wrapper used by FileTile's Edit mode. Split into its own
// module so React.lazy can defer the ~200KB CodeMirror bundle until the
// user actually flips to Edit — the Preview path stays lightweight.

import CodeMirror, { type Extension } from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css as cssLang } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';

function langFor(name: string): Extension[] {
  const ext = name.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': return [javascript({ jsx: true })];
    case 'ts': case 'tsx': return [javascript({ jsx: true, typescript: true })];
    case 'py': return [python()];
    case 'html': case 'htm': case 'vue': case 'svelte': return [html()];
    case 'css': case 'scss': case 'less': return [cssLang()];
    case 'json': return [json()];
    case 'md': case 'markdown': case 'mdx': return [markdown()];
    default: return [];
  }
}

export default function CodeEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={langFor(path)}
      theme={oneDark}
      height="100%"
      style={{ height: '100%' }}
      basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
    />
  );
}
