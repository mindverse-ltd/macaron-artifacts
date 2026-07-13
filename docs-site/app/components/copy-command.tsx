import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

// A single copy-to-clipboard command line. Kept minimal on purpose: the docs
// pages use MDX code blocks, but the landing route is plain TSX, so we render a
// lightweight terminal row instead of pulling Shiki into the home bundle.
export function CopyCommand({ command, prompt = '$' }: { command: string; prompt?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="group flex items-center gap-3 rounded-lg border bg-fd-secondary/30 px-3 py-2 font-mono text-sm">
      <span className="select-none text-fd-muted-foreground">{prompt}</span>
      <code className="flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
      <button
        type="button"
        aria-label="Copy command"
        className="shrink-0 rounded-md p-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
        onClick={() => {
          navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
