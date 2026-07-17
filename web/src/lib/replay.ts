import type { Message } from '@macaron/shared';

export type ReplayTiming = 'exact' | 'natural' | 'compact';

export type ReplayTimelineEntry = { message: Message; start: number; end: number; renderUICode?: string };

const RENDER_UI_TOKENS_PER_SECOND = 40;
const CHARS_PER_TOKEN = 4;

function timestamp(message: Message): number | undefined {
  const value = message.timestamp ? new Date(message.timestamp).getTime() : NaN;
  return Number.isFinite(value) ? value : undefined;
}

export function compressReplayGap(gap: number, timing: ReplayTiming): number {
  if (timing === 'exact') return gap;
  if (timing === 'compact') return Math.min(2_000, gap);
  if (gap <= 2_000) return gap;
  return 2_000 + 2_000 * Math.log(gap / 2_000);
}

export function createReplayTimeline(messages: Message[], timing: ReplayTiming = 'natural'): ReplayTimelineEntry[] {
  let elapsed = 0;
  return messages.map((message, index) => {
    if (index > 0) {
      const current = timestamp(message);
      const previous = timestamp(messages[index - 1]!);
      const gap = current === undefined || previous === undefined ? 250 : compressReplayGap(Math.max(0, current - previous), timing);
      elapsed += gap;
      const renderUICode = getRenderUICode(message);
      const streamDuration = renderUICode ? compressReplayGap(renderUICode.length / CHARS_PER_TOKEN / RENDER_UI_TOKENS_PER_SECOND * 1_000, timing) : 0;
      return { message, start: Math.max(0, elapsed - streamDuration), end: elapsed, renderUICode };
    }
    return { message, start: 0, end: 0 };
  });
}

export function replayFrame(timeline: ReplayTimelineEntry[], position: number): Message[] {
  const visible: Message[] = [];
  for (const entry of timeline) {
    if (position >= entry.end) {
      visible.push(entry.message);
      continue;
    }
    if (entry.renderUICode && position >= entry.start) {
      const progress = (position - entry.start) / (entry.end - entry.start);
      visible.push(withRenderUICode(entry.message, entry.renderUICode.slice(0, Math.max(1, Math.floor(entry.renderUICode.length * progress)))));
      continue;
    }
    break;
  }
  return visible;
}

function getRenderUICode(message: Message): string | undefined {
  for (const block of message.blocks) {
    if (block.kind !== 'tool_use' || !(block.name === 'mcp:macaron/render_ui' || block.name.endsWith('__render_ui'))) continue;
    const code = (block.input as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && code) return code;
  }
}

function withRenderUICode(message: Message, code: string): Message {
  return { ...message, blocks: message.blocks.map((block) => block.kind === 'tool_use' && (block.name === 'mcp:macaron/render_ui' || block.name.endsWith('__render_ui')) ? { ...block, input: { ...(block.input as Record<string, unknown>), code, _replayStreaming: true } } : block) };
}
