'use client';
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The named overflowing region must support keyboard scrolling. */

import { memo, useId, useLayoutEffect, useMemo, useState } from 'react';
import { Disclosure, DisclosureButton } from '@headlessui/react';
import type { ReasoningUIPart } from 'ai';
import { Streamdown } from 'streamdown';
import { markdownPlugins } from '../../chat/markdown';
import { normalizeMath } from '../../chat/math';
import { Icon } from '../Icon';
import { STREAMING_ANIMATION, StreamingSpan } from './streaming-animation';
import { analyzeReasoning } from './reasoning-model';
import { useReasoningScroll } from './useReasoningScroll';
import { useReasoningCollapse } from './useReasoningCollapse';
import { exportRehypePlugins } from '../../chat/export-links';
import './Reasoning.css';

const COMPONENTS = { span: StreamingSpan };
const Markdown = memo(function Markdown({ text, live }: { text: string; live: boolean }) {
  // Reasoning is text, never an executable UI4A surface. Streamdown handles incomplete Markdown.
  return <Streamdown plugins={markdownPlugins} rehypePlugins={exportRehypePlugins} components={COMPONENTS} controls={false} animated={live ? STREAMING_ANIMATION : false} isAnimating={live}>{normalizeMath(text)}</Streamdown>;
});

export const Reasoning = memo(function Reasoning({ parts, live, superseded = false }: { parts: readonly ReasoningUIPart[]; live: boolean; superseded?: boolean }) {
  const active = live && parts.some(part => part.state !== 'done');
  const presentation = useMemo(() => analyzeReasoning(parts, active), [parts, active]);
  if (!presentation.entries.length && !active) return null;
  return <Disclosure as="section" className="reasoning" data-reasoning-kind={presentation.kind} data-reasoning-active={active}>
    {({ open }) => <ReasoningView presentation={presentation} active={active} historyOpen={open} superseded={superseded} />}
  </Disclosure>;
});

function ReasoningView({ presentation, active, historyOpen, superseded }: { presentation: ReturnType<typeof analyzeReasoning>; active: boolean; historyOpen: boolean; superseded: boolean }) {
  const regionId = useId();
  const { kind, entries } = presentation;
  const visible = kind === 'summary' && !historyOpen ? entries.slice(-1) : entries;
  const contentKey = `${historyOpen}:${visible.map(entry => `${entry.key}:${entry.text}`).join('\n')}`;
  const { viewport, content, following, overflowing, resume } = useReasoningScroll(contentKey, active && !historyOpen);
  const [multiline, setMultiline] = useState(false), [userOpen, setUserOpen] = useState<boolean | null>(null), [inspecting, setInspecting] = useState(false);
  const [initiallySuperseded] = useState(superseded);
  useLayoutEffect(() => {
    const body = content.current, panel = viewport.current?.parentElement;
    if (!body || !panel) return;
    const measure = () => {
      // Closed details have no layout. Keep the last real measurement instead of reopening on a zero-height ResizeObserver notification.
      if (!body.getClientRects().length) return;
      const style = getComputedStyle(body), height = body.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setMultiline(height > parseFloat(style.lineHeight) * 1.5);
    };
    const observer = new ResizeObserver(measure); observer.observe(body); measure();
    return () => observer.disconnect();
  }, [content, viewport]);
  const collapsible = superseded && !active && multiline, collapsed = collapsible && (userOpen === false || (userOpen === null && !historyOpen && !inspecting));
  // Backfilled history was never visibly expanded; only animate a live block handing off to its successor.
  const { disclosure, minHeight } = useReasoningCollapse(collapsed, userOpen === null && !initiallySuperseded);
  useLayoutEffect(() => {
    const panel = viewport.current?.parentElement;
    if (!panel || collapsed || userOpen !== null) return;
    const inspect = (event?: Event) => {
      // focusout fires before activeElement settles; relatedTarget preserves focus moving within this reasoning block.
      const target = event?.type === 'focusout' ? (event as FocusEvent).relatedTarget : document.activeElement, selection = document.getSelection();
      setInspecting((target instanceof Node && panel.contains(target)) || !!(selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(panel)));
    };
    inspect(); panel.addEventListener('focusin', inspect); panel.addEventListener('focusout', inspect); document.addEventListener('selectionchange', inspect);
    // Closed blocks never observe page-wide selections: select-all must not reopen hidden reasoning.
    return () => { panel.removeEventListener('focusin', inspect); panel.removeEventListener('focusout', inspect); document.removeEventListener('selectionchange', inspect); };
  }, [collapsed, userOpen, viewport]);
  const preview = entries.at(-1)?.text.split('\n').find(line => line.trim())?.replace(/^\s*(?:#{1,6}\s+|\*\*|__|>\s*)|(?:\*\*|__)\s*$/g, '').trim() || '思考过程';
  return <details ref={disclosure} className="reasoning-disclosure" open={!collapsed} style={{ minHeight }}>
    {/* Native details also works in downloaded transcripts; the full Markdown and its scroll controller stay mounted. */}
    <summary hidden={!collapsible} className="reasoning-summary" aria-controls={`${regionId}-panel`} onClick={event => { event.preventDefault(); event.currentTarget.focus(); setUserOpen(collapsed); }}><Icon name="chevronDown" className="reasoning-action-icon" /><span className="reasoning-summary-label">思考过程</span><span className="reasoning-summary-preview">{preview}</span></summary>
    <div id={`${regionId}-panel`} className="reasoning-main">
      <span className="reasoning-sr-only" role="status">{active ? '正在思考' : ''}</span>
      <div id={regionId} ref={viewport} className="reasoning-viewport no-scrollbar" role="region" aria-label={kind === 'summary' ? '思考摘要' : '思考过程'} tabIndex={overflowing ? 0 : undefined}>
        <div ref={content} className="reasoning-content">
          {/* Keep earlier summaries mounted so exports include history that has never been opened. */}
          {entries.map(entry => <div key={entry.key} hidden={kind === 'summary' && !historyOpen && entry.key !== entries.at(-1)?.key} data-reasoning-entry data-reasoning-streaming={entry.streaming} data-reasoning-latest={kind === 'summary' ? entry.key === entries.at(-1)?.key : undefined}><Markdown text={entry.text} live={entry.streaming} /></div>)}
          {!entries.length && active ? <span className="reasoning-placeholder">正在思考</span> : null}
        </div>
      </div>
      {(kind === 'summary' && entries.length > 1) || (overflowing && !following && active && !historyOpen) ? <div className="reasoning-actions">
        {kind === 'summary' && entries.length > 1 ? <DisclosureButton data-export-reasoning-toggle data-reasoning-count={entries.length} aria-controls={regionId} className="reasoning-action" onClick={() => { if (historyOpen) resume(); }} title={historyOpen ? '仅显示最新摘要' : '查看先前摘要'}><Icon name="chevronDown" className="reasoning-action-icon" /><span>{historyOpen ? '仅显示最新' : `${entries.length} 段摘要`}</span></DisclosureButton> : null}
        {overflowing && !following && active && !historyOpen ? <button type="button" className="reasoning-action reasoning-resume" onClick={resume} title="继续跟随思考"><Icon name="arrowDown" className="reasoning-action-icon" /><span>跟随最新</span></button> : null}
      </div> : null}
    </div>
  </details>;
}
