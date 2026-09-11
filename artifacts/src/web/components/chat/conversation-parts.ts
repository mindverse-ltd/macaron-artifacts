import type { ChatMessage } from '../../../shared/types';
import { isToolPart } from './tool-groups';
import { reasoningRunAt } from './reasoning-model';

export function conversationParts(parts: ChatMessage['parts'], streaming: boolean) {
  const outputs = new Map<string, string>(), firstDelta = new Map<string, number>(), toolIds = new Set<string>();
  for (const [index, part] of parts.entries()) {
    if (isToolPart(part) && part.toolCallId) toolIds.add(part.toolCallId);
    if (part.type !== 'data-command') continue;
    const { toolCallId, output } = part.data;
    // Legacy sessions stored cumulative output; current sessions append independent deltas.
    outputs.set(toolCallId, part.id === `command:${toolCallId}` ? output : (outputs.get(toolCallId) ?? '') + output);
    if (!firstDelta.has(toolCallId)) firstDelta.set(toolCallId, index);
  }
  const entries = parts.flatMap((part, index): { part: ChatMessage['parts'][number]; index: number }[] => {
    if (part.type === 'data-command') return !toolIds.has(part.data.toolCallId) && firstDelta.get(part.data.toolCallId) === index
      ? [{ index, part: { type: 'dynamic-tool', toolName: 'command', toolCallId: part.data.toolCallId, input: {}, ...(streaming ? { state: 'input-available' } : { state: 'output-available', output: outputs.get(part.data.toolCallId) }) } }]
      : [];
    if (part.type === 'reasoning') {
      const run = reasoningRunAt(parts, index);
      return run && (run.some(item => item.text.trim()) || streaming && index + run.length === parts.length) ? [{ part, index }] : [];
    }
    if (isToolPart(part) || part.type === 'data-approval' || part.type === 'text' && part.text.trim() || part.type === 'file' && part.mediaType.startsWith('image/')) return [{ part, index }];
    return [];
  });
  return { entries, outputs };
}
