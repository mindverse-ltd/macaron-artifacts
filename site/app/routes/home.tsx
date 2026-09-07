import type { Route } from './+types/home';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button';
import { Link } from 'react-router';
import { Check, Clipboard, MonitorPlay, MessagesSquare, SlidersHorizontal, Wand2, Layers, Terminal } from 'lucide-react';
import { baseOptions } from '@/lib/layout.shared';
import { track, type SiteEvents } from '@/lib/telemetry';
import ChatShowcase from '@/components/chat-showcase';

function CommandCopyButton({ code, on }: { code: string; on: SiteEvents['command_copy'] }) {
  const [checked, onClick] = useCopyButton(() => { navigator.clipboard.writeText(code); track('command_copy', on); });
  return <button type="button" data-checked={checked || undefined} className="inline-flex items-center justify-center rounded-md p-1 text-sm font-medium transition-colors duration-100 hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring data-checked:text-fd-accent-foreground [&_svg]:size-4" aria-label={checked ? 'Copied Text' : 'Copy Text'} onClick={onClick}>{checked ? <Check /> : <Clipboard />}</button>;
}

function Command({ code }: { code: string }) {
  return <DynamicCodeBlock lang="bash" code={code} codeblock={{ allowCopy: false, Actions: ({ className }) => <div className={className}><CommandCopyButton code={code} on={{ engine: 'shared', kind: 'bunx' }} /></div> }} />;
}

export function meta({}: Route.MetaArgs) {
  return [{ title: 'Macaron Artifacts' }, { name: 'description', content: 'One local WebUI for Claude Code and Codex, with streaming conversations, generated UI, and shared Shiki themes.' }];
}

// The package name and CLI stay the same whichever harness a conversation uses.
const PKG = `https://pkg.pr.new/mindverse-ltd/macaron-artifacts/macaron-artifacts@${__COMMIT_SHA__}`;

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-col items-center flex-1 px-4">
        <section className="flex flex-col items-center text-center max-w-2xl pt-20 pb-16">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-fd-muted-foreground mb-6"><Terminal className="size-3.5" /> Claude Code &amp; Codex</span>
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">Macaron Artifacts</h1>
          <p className="text-fd-muted-foreground text-lg mb-8">One local WebUI for your coding harnesses. Stream conversations and interactive UI, then pick Claude Code or Codex for the next session.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link className="text-sm bg-fd-primary text-fd-primary-foreground rounded-full font-medium px-5 py-2.5 transition-opacity hovered:opacity-90" to="/docs" onClick={() => track('cta_click', { target: 'docs', section: 'hero' })}>Read the Docs</Link>
            <Link className="text-sm border rounded-full font-medium px-5 py-2.5 transition-colors hovered:bg-fd-accent hovered:text-fd-accent-foreground" to="/docs/usage" onClick={() => track('cta_click', { target: 'quick-start', section: 'hero' })}>Quick Start</Link>
          </div>
        </section>

        <section className="w-full max-w-xl pb-20"><ChatShowcase /></section>

        <section className="w-full max-w-3xl pb-20">
          <div className="mb-6 text-center"><h2 className="text-2xl font-semibold mb-1">Install</h2><p className="text-fd-muted-foreground">One package, one local server. Choose the harness inside the app.</p></div>
          <Command code={`bunx macaron-artifacts@${PKG}`} />
          <p className="mt-3 text-sm text-fd-muted-foreground">Requires Node.js 22 or newer and an installed, authenticated Claude Code or Codex CLI. The preview package is pinned to this build's commit.</p>
          <p className="mt-3 text-sm text-fd-muted-foreground">Open <a className="text-fd-foreground underline underline-offset-4" href="http://127.0.0.1:43860">http://127.0.0.1:43860</a>, then create a conversation with your harness and workspace. See <Link className="text-fd-foreground underline underline-offset-4" to="/docs/usage">Quick Start</Link> for installation and configuration.</p>
        </section>

        <section className="w-full max-w-5xl pb-24">
          <div className="mb-6"><h2 className="text-2xl font-semibold mb-1">Run Agents With a UI</h2><p className="text-fd-muted-foreground">The same conversation interface, whichever harness you choose.</p></div>
          <Cards className="grid-cols-1 sm:grid-cols-3">
            <Card icon={<MonitorPlay />} title="Shared Interface" href="/docs/usage" onClick={() => track('cta_click', { target: 'shared-interface', section: 'run-with-ui' })}>Choose Claude Code or Codex per conversation. Workspaces, sessions, and approvals stay in one app.</Card>
            <Card icon={<MessagesSquare />} title="Live Conversations" href="/docs/usage" onClick={() => track('cta_click', { target: 'live-chat', section: 'run-with-ui' })}>Follow native text, reasoning, and tool events as they arrive. Reconnect to active turns after refreshing.</Card>
            <Card icon={<SlidersHorizontal />} title="Native Configuration" href="/docs/usage" onClick={() => track('cta_click', { target: 'native-configuration', section: 'run-with-ui' })}>Use your harness's existing login and settings. Choose a model when starting a conversation.</Card>
          </Cards>
          <div className="mt-12 mb-6"><h2 className="text-2xl font-semibold mb-1">Generated UI, Two Ways</h2><p className="text-fd-muted-foreground">Small interactive answers in the conversation, persistent tools in Canvas.</p></div>
          <Cards>
            <Card icon={<Wand2 />} title="Inline UI4A" href="/docs/usage" onClick={() => track('cta_click', { target: 'inline-ui4a', section: 'extend' })}>A ui4a/tsx block renders while its source streams. Components inherit the same theme as the app.</Card>
            <Card icon={<Layers />} title="File Canvas" href="/docs/usage" onClick={() => track('cta_click', { target: 'file-canvas', section: 'extend' })}>Files in .artifacts open in the side panel, with relative modules and persistent component state.</Card>
          </Cards>
        </section>
      </div>
    </HomeLayout>
  );
}
