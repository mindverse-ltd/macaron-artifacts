import { useLayoutEffect, useRef, useState } from 'react';
import { Transition } from '@headlessui/react';
import type { Approval } from '../../../shared/types';
import { Button } from '../ui4a-ui';
import { CodeBlock } from '../code/CodeBlock';
import { Collapsible } from '../code/Collapsible';
import './ApprovalCard.css';

export function ApprovalCard({ approval, onDecide }: { approval: Approval & { resolved?: boolean }; onDecide: (approved: boolean) => Promise<unknown> }) {
  const [decision, setDecision] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [settled, setSettled] = useState(Boolean(approval.resolved));
  const closing = approval.resolved || decision !== undefined;
  const card = useRef<HTMLElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  // Disabling the clicked button can blur it before the asynchronous request resolves.
  const rememberFocus = () => { const active = document.activeElement; if (active instanceof HTMLElement && card.current?.contains(active)) priorFocus.current = active; else if (active !== document.body) priorFocus.current = null; };
  const decide = async (approved: boolean) => { if (busy || closing) return; rememberFocus(); setBusy(true); setError(undefined); try { await onDecide(approved); setDecision(approved); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  useLayoutEffect(() => { if (!settled && (busy || !error)) return; const previous = priorFocus.current; priorFocus.current = null; if (previous && (document.activeElement === previous || document.activeElement === document.body)) (settled ? status.current : previous)?.focus({ preventScroll: true }); }, [settled, busy, error]);
  return <div className="approval-slot">
    <Transition show={!closing} appear beforeLeave={rememberFocus} afterLeave={() => setSettled(true)}>
      <div className="approval-presence"><div className="min-h-0 overflow-hidden"><section ref={card} data-approval-id={approval.id} className="approval-card overflow-clip rounded-xl bg-surface-2 p-3" aria-label="操作确认" aria-busy={busy}><p className="approval-title mb-2 text-sm font-medium">允许 {approval.tool}？</p><Collapsible><CodeBlock code={JSON.stringify(approval.input, null, 2)} lang="json" /></Collapsible>{error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}<div className="mt-3 flex gap-2"><Button data-approval-decision="allow" size="sm" disabled={busy || closing} onClick={() => void decide(true)}>允许这次</Button><Button data-approval-decision="deny" size="sm" variant="secondary" disabled={busy || closing} onClick={() => void decide(false)}>拒绝</Button></div></section></div></div>
    </Transition>
    {/* Reserve the final line during collapse, but reveal it only after the card has left. */}
    <p ref={status} tabIndex={settled ? -1 : undefined} role={settled ? 'status' : undefined} aria-hidden={!settled} className="approval-status text-xs text-muted">{approval.tool} · {decision === false ? '已拒绝' : '已处理'}</p>
  </div>;
}
