import type { Message } from '@macaron/shared';

export type ReplayTiming = 'exact' | 'natural' | 'compact';

export type ReplayTimelineEntry = { message: Message; end: number };

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
      return { message, end: elapsed };
    }
    return { message, end: 0 };
  });
}

export function replayFrame(timeline: ReplayTimelineEntry[], position: number): Message[] {
  const visible: Message[] = [];
  for (const entry of timeline) {
    if (position >= entry.end) {
      visible.push(entry.message);
      continue;
    }
    break;
  }
  return visible;
}
