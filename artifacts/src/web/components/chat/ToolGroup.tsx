import type { ReactNode } from 'react';
import { ToolDisclosure } from './ToolDisclosure';
import { summarizeTools, type ToolPartLike } from './tool-groups';
import { Icon } from '../Icon';

export function ToolGroup({ parts, live, children }: { parts: readonly ToolPartLike[]; live: boolean; children: ReactNode }) {
  const summary = summarizeTools(parts, live);
  const complete = parts.every(part => part.state === 'output-available');
  return <ToolDisclosure className={`tool-group${summary.failed ? ' tool-group-failed' : ''}`} defaultOpen={false} working={summary.working} label={summary.label} hint={summary.detail} hintTitle={summary.detailTitle} indicator={summary.working ? <span className="tool-group-pulse" /> : <Icon name={summary.failed ? 'x' : complete ? 'check' : 'ellipsis'} />}>
    <div className="tool-group-details">{children}</div>
  </ToolDisclosure>;
}
