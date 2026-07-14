import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableWeeks, buildHeatmap, levelFor, navCells, navTarget, utcToDay, dayToUTC, DAY } from '../src/lib/heatmap';

// Helper: synthesize a `daily` payload spanning [since, until] with 1 msg/day.
function fill(since: string, until: string) {
  const out: Array<{ date: string; messageCount: number }> = [];
  for (let ms = dayToUTC(since); ms <= dayToUTC(until); ms += DAY) out.push({ date: utcToDay(ms), messageCount: 1 });
  return out;
}

test('levelFor buckets by busiest day', () => {
  assert.equal(levelFor(0, 10), 0);
  assert.equal(levelFor(1, 10), 1);
  assert.equal(levelFor(10, 10), 4);
  assert.equal(levelFor(5, 0), 0); // no activity → level 0 even if count > 0
});

test('buildHeatmap renders exactly the requested whole columns, no stretch', () => {
  const daily = fill('2024-01-01', '2026-07-14');
  const grid = buildHeatmap(daily, '2026-07-14', 20);
  assert.equal(grid.weeks.length, 20, 'exactly 20 columns');
  for (const week of grid.weeks) assert.equal(week.length, 7, 'every column has 7 weekday rows');
  // The grid ends at the week containing untilDate; the last real day is untilDate.
  const lastRealKey = grid.weeks.flat().filter(Boolean).map((c) => c!.key).sort().at(-1);
  assert.equal(lastRealKey, '2026-07-14');
});

test('buildHeatmap shows the MOST-RECENT days when fewer columns than history fit', () => {
  const daily = fill('2024-01-01', '2026-07-14');
  const grid = buildHeatmap(daily, '2026-07-14', 4); // only 4 weeks fit
  const firstRealKey = grid.weeks.flat().filter(Boolean).map((c) => c!.key).sort()[0];
  // 4 columns back from the week of 2026-07-14 (Tue) → grid starts 2026-06-21 (Sun).
  assert.equal(firstRealKey, '2026-06-21');
});

test('empty days become level-0 cells (light solid square), not gaps', () => {
  const daily = [{ date: '2026-07-14', messageCount: 5 }]; // one active day in the window
  const grid = buildHeatmap(daily, '2026-07-14', 3);
  const cells = grid.weeks.flat().filter(Boolean);
  assert.ok(cells.length > 1, 'many real day cells');
  assert.equal(cells.filter((c) => c!.count === 0).length, cells.length - 1, 'all but one are zero-count cells');
});

test('availableWeeks caps the column count to the window span', () => {
  // A 30-day window spans ~5 week columns.
  const daily = fill('2026-06-15', '2026-07-14');
  assert.equal(availableWeeks(daily, '2026-06-15', '2026-07-14', '30d'), 5);
  // 'all' clamps to the first active day.
  const long = fill('2026-01-01', '2026-07-14');
  assert.ok(availableWeeks(long, '1970-01-01', '2026-07-14', 'all') >= 27);
});

test('navTarget global/boundary uses date keys not DOM order', () => {
  const daily = fill('2026-07-01', '2026-07-31');
  const grid = buildHeatmap(daily, '2026-07-31', 6);
  const cells = navCells(grid);
  assert.equal(navTarget(cells, cells[3]!.key, 'Home', true), cells.map((c) => c.key).sort()[0], 'Ctrl+Home → earliest date');
  assert.equal(navTarget(cells, cells[3]!.key, 'End', true), '2026-07-31', 'Ctrl+End → latest date');
});

test('navTarget arrows stay put at an edge', () => {
  const daily = fill('2026-07-01', '2026-07-31');
  const grid = buildHeatmap(daily, '2026-07-31', 6);
  const cells = navCells(grid);
  const earliest = cells.reduce((a, b) => (a.key < b.key ? a : b));
  assert.equal(navTarget(cells, earliest.key, 'ArrowLeft', false), null);
});
