// Pure heatmap geometry — extracted from the Analytics view so the calendar
// bucketing and keyboard-target math can be unit-tested without a DOM. The
// React component measures its container width, derives how many whole week
// columns fit, and passes that count in; everything here is deterministic.

// A calendar day is a plain YYYY-MM-DD string. We iterate days via UTC-noon
// millis so DST shifts never skip or double a day, and never convert to the
// browser's local timezone — the server already keyed `daily` and the window
// bounds (sinceDate/untilDate) in its own timezone, so days line up regardless
// of where the browser runs.
export const dayToUTC = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y!, m! - 1, d!, 12); };
export const utcToDay = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
export const DAY = 86400000;

// A real in-window day carries a key+count. `{ pad: true }` is a VISIBLE but
// inert L0 square drawn to fill whole week-columns BEFORE sinceDate when history
// is shorter than the container — it never focuses, never enters the ARIA date
// range, and never counts as a data value. `null` is a hidden slot for days
// AFTER untilDate (future) in the trailing week.
export type HeatCell = { key: string; count: number } | { pad: true } | null;
export type HeatGrid = { weeks: HeatCell[][]; max: number };

// How many week-columns the active window spans (a leading partial week counts
// as one), so the layout never asks for more columns of data than exist.
export function availableWeeks(daily: Array<{ date: string }>, sinceDate: string, untilDate: string, window: string): number {
  if (!daily.length) return 1;
  const startMs = window === 'all' ? dayToUTC(daily[0]!.date) : dayToUTC(sinceDate);
  const endMs = dayToUTC(untilDate);
  if (endMs < startMs) return 1;
  // Back both ends to their Sunday, then count the weeks between inclusive.
  const gridStart = startMs - new Date(startMs).getUTCDay() * DAY;
  const lastSunday = endMs - new Date(endMs).getUTCDay() * DAY;
  return Math.max(1, Math.round((lastSunday - gridStart) / (7 * DAY)) + 1);
}

// Build the most-recent `weeks` columns (weekday rows Sun→Sat) ending at the
// week that contains untilDate.
// A real day cell (has a date key). Pad squares and hidden future slots aren't.
export function isDay(cell: HeatCell): cell is { key: string; count: number } {
  return cell != null && 'key' in cell;
}

// Build the most-recent `weeks` columns (weekday rows Sun→Sat) ending at the
// week that contains untilDate. Days BEFORE sinceDate become visible-but-inert
// `{ pad: true }` L0 squares so the grid fills whole week-columns even when the
// server window is shorter than the container fits — they never focus, never
// join the ARIA date range, never count. Days AFTER untilDate (future days in
// the trailing week) stay `null` hidden slots. Every in-window slot is a real
// day whose count comes from `daily`, defaulting to 0 so empty days still render
// as light squares.
export function buildHeatmap(daily: Array<{ date: string; messageCount: number }>, sinceDate: string, untilDate: string, weeks: number): HeatGrid {
  const byDay = new Map(daily.map((d) => [d.date, d.messageCount]));
  const startMs = dayToUTC(sinceDate);
  const endMs = dayToUTC(untilDate);
  const lastSunday = endMs - new Date(endMs).getUTCDay() * DAY;
  const n = Math.max(1, weeks);
  const gridStart = lastSunday - (n - 1) * 7 * DAY;

  const out: HeatCell[][] = [];
  let max = 0;
  for (let ms = gridStart, c = 0; c < n; c++) {
    const week: HeatCell[] = [];
    for (let row = 0; row < 7; row++, ms += DAY) {
      if (ms > endMs) { week.push(null); continue; } // future day → hidden slot
      if (ms < startMs) { week.push({ pad: true }); continue; } // before window → inert fill square
      const key = utcToDay(ms);
      const count = byDay.get(key) ?? 0;
      if (count > max) max = count;
      week.push({ key, count });
    }
    out.push(week);
  }
  return { weeks: out, max };
}

// The 5-level shade bucket for a day's count, given the window's busiest day.
export function levelFor(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}

// Flattened, date-sorted list of the in-range cells with their (row, col)
// coordinates — the model the keyboard resolver navigates.
export type NavCell = { key: string; row: number; col: number };
export function navCells(grid: HeatGrid): NavCell[] {
  const out: NavCell[] = [];
  grid.weeks.forEach((week, col) => week.forEach((cell, row) => { if (isDay(cell)) out.push({ key: cell.key, row, col }); }));
  return out;
}

// Resolve the target cell for a key press from the currently-focused cell.
// Returns null when the move lands outside the in-range set (arrow at an edge,
// or a gap) so the caller keeps focus put — never snapping to a DOM-first cell.
// Home/End walk the focused weekday row; ctrl selects the global first/last day
// by DATE KEY, not DOM order, so a partial first/last week can't misplace them.
export function navTarget(cells: NavCell[], fromKey: string, key: string, ctrl: boolean): string | null {
  if (!cells.length) return null;
  const cur = cells.find((c) => c.key === fromKey);
  const at = (r: number, c: number) => cells.find((x) => x.row === r && x.col === c) ?? null;
  const extreme = (pick: (a: NavCell, b: NavCell) => NavCell) => cells.reduce(pick);
  if ((key === 'Home' || key === 'End') && ctrl) {
    const later = key === 'End';
    return extreme((a, b) => ((later ? a.key > b.key : a.key < b.key) ? a : b)).key;
  }
  if (!cur) return null;
  if (key === 'ArrowRight') return at(cur.row, cur.col + 1)?.key ?? null;
  if (key === 'ArrowLeft') return at(cur.row, cur.col - 1)?.key ?? null;
  if (key === 'ArrowDown') return at(cur.row + 1, cur.col)?.key ?? null;
  if (key === 'ArrowUp') return at(cur.row - 1, cur.col)?.key ?? null;
  if (key === 'Home' || key === 'End') {
    const later = key === 'End';
    const inRow = cells.filter((x) => x.row === cur.row);
    return inRow.reduce((a, b) => ((later ? a.col > b.col : a.col < b.col) ? a : b)).key;
  }
  return null;
}
