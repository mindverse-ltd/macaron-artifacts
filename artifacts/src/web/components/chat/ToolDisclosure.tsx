'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { Icon } from '../Icon';
import './ToolDisclosure.css';

type Props = { label: string; hint?: string; hintTitle?: string; working?: boolean; indicator?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean };

export function ToolDisclosure({ working = false, className = '', defaultOpen = working, ...props }: Props) {
  return <Disclosure as="div" className={`tool-disclosure ${className}`} defaultOpen={defaultOpen}>
    {({ close, open }) => <ToolDisclosureContent {...props} working={working} close={close} open={open} />}
  </Disclosure>;
}

function ToolDisclosureContent({ label, hint, hintTitle, working, indicator, action, children, close, open }: Props & { close: (element?: HTMLElement) => void; open: boolean }) {
  const interacted = useRef(false);
  const previousWorking = useRef(working);
  const panel = useRef<HTMLDivElement>(null);
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  useEffect(() => {
    if (previousWorking.current && !working && !interacted.current) {
      const focused = document.activeElement;
      // Auto-collapse must not move focus from the composer or another tool.
      close(focused instanceof HTMLElement && !panel.current?.contains(focused) ? focused : undefined);
    }
    previousWorking.current = working;
  }, [working, close]);
  return <>
    <div className="tool-disclosure-heading">
      <DisclosureButton data-chat-expander className="interactive tool-disclosure-trigger" onClick={() => { interacted.current = true; }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') interacted.current = true; }}>
        <span className="tool-disclosure-icon" aria-hidden="true">{indicator ?? <Icon name="chevronRight" className="tool-disclosure-chevron" />}</span>
        <span className="tool-disclosure-label" title={label}>{label}</span>
        {hint ? <span className="tool-disclosure-hint" title={hintTitle ?? hint}>{hint}</span> : null}
        {indicator ? <Icon name="chevronDown" className="tool-disclosure-chevron tool-disclosure-trailing" /> : null}
      </DisclosureButton>
      {action}
    </div>
    <DisclosurePanel ref={panel} unmount={false} className="tool-disclosure-panel">{open || visited ? children : null}</DisclosurePanel>
  </>;
}
