import { memo } from 'react';
import { CodeBlock } from '../code/CodeBlock';
import { Collapsible } from '../code/Collapsible';
import { Icon } from '../Icon';
import { toolOutput } from './tool-output';
import { artifactEntryPath } from '../../../shared/artifact-path';
import { activityPresentation, toolActivities } from './tool-activity';

type Tool = { type: string; toolName?: string; state?: string; input?: unknown; output?: unknown; errorText?: string; toolCallId?: string };
export const ToolCall = memo(function ToolCall({ part, commandOutput, cwd = '', onArtifact }: { part: Tool; commandOutput?: string; cwd?: string; onArtifact: (path: string) => void }) {
  const name = part.toolName ?? part.type.replace(/^tool-/, '');
  const input = part.input as Record<string, unknown> | undefined;
  const file = input?.file_path ?? input?.path ?? input?.filePath ?? input?.filename;
  const command = input?.command ?? input?.cmd;
  const hint = typeof file === 'string' ? file : typeof command === 'string' ? command : '';
  const activity = activityPresentation(toolActivities(part) ?? []);
  const source = typeof input?.content === 'string' ? input.content : typeof command === 'string' ? command : input ? JSON.stringify(input, null, 2) : '';
  // Source is highlighted separately; retain cwd, timeouts and other invocation parameters.
  const parameters = input && (typeof input.content === 'string' || typeof command === 'string') ? Object.fromEntries(Object.entries(input).filter(([key]) => typeof input.content === 'string' ? key !== 'content' : key !== 'command' && key !== 'cmd')) : {};
  const output = toolOutput(part, commandOutput);
  const canvas = typeof file === 'string' ? artifactEntryPath(file, cwd) : undefined;
  const failed = part.state === 'output-error' || part.state === 'output-denied' || Boolean(part.errorText);
  return <section className="tool-call-detail" aria-label={name}>
    <div className="tool-call-heading"><span className="tool-call-name" title={name}>{activity?.label ?? name}</span><span className="tool-call-hint" title={activity?.title ?? hint}>{activity?.detail ?? hint}</span>{failed ? <span className="text-danger">{part.state === 'output-denied' ? '已拒绝' : '失败'}</span> : part.state === 'approval-requested' ? <span>待确认</span> : part.state === 'output-available' ? <Icon name="check" /> : null}</div>
    {Object.keys(parameters).length ? <Collapsible className="theme-code"><CodeBlock code={JSON.stringify(parameters, null, 2)} lang="json" /></Collapsible> : null}
    {source ? <Collapsible className="theme-code"><CodeBlock code={source} lang={typeof input?.content === 'string' ? 'tsx' : typeof command === 'string' ? 'bash' : 'json'} /></Collapsible> : null}
    {output ? <Collapsible className="theme-code"><CodeBlock code={output} lang="text" /></Collapsible> : null}
    {part.errorText ? <p className="px-3 py-2 whitespace-pre-wrap text-danger">{part.errorText}</p> : null}
    {part.state === 'output-denied' ? <p className="px-3 py-2 text-danger">这次工具调用未获批准。</p> : null}
    {canvas ? <button type="button" onClick={() => onArtifact(file as string)} className="interactive m-2 rounded-md px-2 py-1 text-muted hover:bg-surface-3 hover:text-hover-fg">在 Canvas 中打开</button> : null}
  </section>;
});
