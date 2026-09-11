'use client';
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The named overflowing region must support keyboard scrolling. */

import { memo, useId, useMemo } from 'react';
import { Disclosure, DisclosureButton } from '@headlessui/react';
import type { ReasoningUIPart } from 'ai';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { Icon } from '../Icon';
import { analyzeReasoning } from './reasoning-model';
import { useReasoningScroll } from './useReasoningScroll';
import './Reasoning.css';

const PLUGINS = { cjk };
const Markdown = memo(function Markdown({ text, live }: { text: string; live: boolean }) {
  // Reasoning is text, never an executable UI4A surface. Streamdown handles incomplete Markdown.
  return <Streamdown plugins={PLUGINS} controls={false} isAnimating={live}>{text}</Streamdown>;
});

export const Reasoning = memo(function Reasoning({ parts, live }: { parts: readonly ReasoningUIPart[]; live: boolean }) {
  const active = live && parts.some(part => part.state !== 'done');
  const presentation = useMemo(() => analyzeReasoning(parts, active), [parts, active]);
  if (!presentation.entries.length && !active) return null;
  return <Disclosure as="section" className="reasoning" data-reasoning-kind={presentation.kind} data-reasoning-active={active}>
    {({ open }) => <ReasoningView presentation={presentation} active={active} historyOpen={open} />}
  </Disclosure>;
});

function ReasoningView({ presentation, active, historyOpen }: { presentation: ReturnType<typeof analyzeReasoning>; active: boolean; historyOpen: boolean }) {
  const regionId = useId();
  const { kind, entries } = presentation;
  const visible = kind === 'summary' && !historyOpen ? entries.slice(-1) : entries;
  const contentKey = `${historyOpen}:${visible.map(entry => `${entry.key}:${entry.text}`).join('\n')}`;
  const { viewport, content, following, overflowing, resume } = useReasoningScroll(contentKey, active && !historyOpen);
  return <>
    <div className="reasoning-indicator" aria-hidden="true" />
    <div className="reasoning-main">
      <span className="reasoning-sr-only" role="status">{active ? '正在思考' : ''}</span>
      <div id={regionId} ref={viewport} className="reasoning-viewport" role="region" aria-label={kind === 'summary' ? '思考摘要' : '思考过程'} tabIndex={overflowing ? 0 : undefined}>
        <div ref={content} className="reasoning-content">
          {visible.map(entry => <div key={entry.key} data-reasoning-entry data-reasoning-latest={kind === 'summary' ? entry.key === entries.at(-1)?.key : undefined} className={kind === 'summary' && !historyOpen ? 'reasoning-current' : undefined}><Markdown text={entry.text} live={active} /></div>)}
          {!entries.length && active ? <span className="reasoning-placeholder">正在思考</span> : null}
        </div>
      </div>
      {(kind === 'summary' && entries.length > 1) || (overflowing && !following && active && !historyOpen) ? <div className="reasoning-actions">
        {kind === 'summary' && entries.length > 1 ? <DisclosureButton aria-controls={regionId} className="reasoning-action" onClick={() => { if (historyOpen) resume(); }} title={historyOpen ? '仅显示最新摘要' : '查看先前摘要'}><Icon name="chevronDown" className="reasoning-action-icon" /><span>{historyOpen ? '仅显示最新' : `${entries.length} 段摘要`}</span></DisclosureButton> : null}
        {overflowing && !following && active && !historyOpen ? <button type="button" className="reasoning-action reasoning-resume" onClick={resume} title="继续跟随思考"><Icon name="arrowDown" className="reasoning-action-icon" /><span>跟随最新</span></button> : null}
      </div> : null}
    </div>
  </>;
}
