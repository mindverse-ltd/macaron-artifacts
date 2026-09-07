// Theme store: light / dark / system, persisted to localStorage.
// The pre-paint script in index.html sets data-theme before React mounts to
// avoid FOUC; this module keeps it in sync at runtime and on OS changes.
// Keep the storage key and resolution rule in lockstep with index.html.

import { useSyncExternalStore } from 'react';
import { loadTheme, themePalette, THEME_OPTIONS as SHIKI_OPTIONS, type ThemeId } from '../../../artifacts/src/web/theme/themes';
export const PALETTE_OPTIONS = SHIKI_OPTIONS.map(option => ({ ...option, label: option.id === 'playground' ? 'Original' : option.label }));

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'macaron-theme';
const PALETTE_KEY = 'macaron-shiki-theme';
function readPalette(): ThemeId { try { const id = localStorage.getItem(PALETTE_KEY); return PALETTE_OPTIONS.some(option => option.id === id) ? id as ThemeId : 'playground'; } catch { return 'playground'; } }
let paletteId: ThemeId = typeof window === 'undefined' ? 'playground' : readPalette();
let paletteSequence = 0;
const paletteProperties = new Set<string>();
const mql = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function read(): Theme {
  // Guard storage like index.html's pre-paint script does: this runs at
  // module-eval via `current = read()`, so a SecurityError (private mode /
  // storage disabled) would otherwise abort the whole bundle before mount.
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return mql?.matches ? 'dark' : 'light';
  return theme;
}

let current: Theme = typeof window !== 'undefined' ? read() : 'system';
const listeners = new Set<() => void>();

function apply() {
  const resolved = resolveTheme(current);
  if (paletteId.startsWith('github-')) paletteId = resolved === 'dark' ? 'github-dark' : 'github-light';
  else if (paletteId.startsWith('vitesse-') || (paletteId === 'nord' && resolved === 'light')) paletteId = resolved === 'dark' ? 'vitesse-dark' : 'vitesse-light';
  document.documentElement.setAttribute('data-theme', resolved);
  const sequence = ++paletteSequence;
  const root = document.documentElement;
  for (const property of paletteProperties) root.style.removeProperty(property);
  paletteProperties.clear();
  if (paletteId === 'playground') return;
  void loadTheme(paletteId).then(theme => {
    if (sequence !== paletteSequence) return;
    const p = themePalette(theme, resolveTheme(current) === 'dark');
    const mix = (percent: number) => `color-mix(in srgb, ${p.fg} ${percent}%, ${p.surface})`;
    const values = { ...p, bg: p.surface, text: p.fg, 'text-2': p.muted, 'muted-2': mix(40), 'code-bg': p['surface-2'], 'border-strong': mix(24), 'accent-hover': p.accent, 'accent-soft': `color-mix(in srgb, ${p.accent} 10%, transparent)`, 'accent-soft-2': `color-mix(in srgb, ${p.accent} 18%, transparent)`, good: p.success, bad: p.danger,
      'cx-bg': p.surface, 'cx-surface': p['surface-2'], 'cx-sidebar': p['surface-2'], 'cx-hover': p['surface-3'], 'cx-active': mix(14), 'cx-code': p['surface-2'], 'cx-code-strong': p.fg, 'cx-border': p.border, 'cx-border-strong': mix(24), 'cx-text': p.fg, 'cx-text-2': p.muted, 'cx-muted': p.muted, 'cx-muted-2': mix(40), 'cx-good': p.success, 'cx-warn': p.warn, 'cx-bad': p.danger };
    for (const [key, value] of Object.entries(values)) { root.style.setProperty(`--${key}`, value); paletteProperties.add(`--${key}`); }
    for (const [key, value] of Object.entries(values)) if (key.startsWith('cx-')) { const property = `--kx-${key.slice(3)}`; root.style.setProperty(property, value); paletteProperties.add(property); }
    const generated = { background: p.surface, foreground: p.fg, card: p['surface-2'], 'card-foreground': p.fg, popover: p['surface-2'], 'popover-foreground': p.fg, primary: p.accent, 'primary-foreground': p['accent-fg'], secondary: p['surface-3'], 'secondary-foreground': p.fg, muted: p['surface-3'], 'muted-foreground': p.muted, accent: p['surface-3'], 'accent-foreground': p.fg, destructive: p.danger, 'destructive-foreground': '#fff', border: p.border, input: p.border, ring: p.accent };
    // Legacy components expect HSL channels. Relative colors preserve that contract
    // for Shiki's hex colors and the derived color-mix values without parsing strings.
    for (const [key, value] of Object.entries(generated)) { const property = `--macaron-${key}`; root.style.setProperty(property, `from ${value} h s l`); paletteProperties.add(property); }
  }).catch(error => console.error('[theme] Shiki palette failed to load', error));
}

export function setShikiTheme(id: ThemeId) {
  paletteId = id;
  try { localStorage.setItem(PALETTE_KEY, id); } catch { /* The in-memory selection still works. */ }
  setTheme(id === 'playground' ? current : id === 'nord' || id.endsWith('dark') ? 'dark' : 'light');
}

export function setTheme(theme: Theme) {
  current = theme;
  apply();
  // Apply + notify even if persistence throws, so the toggle never dead-ends
  // on a storage write failure (quota exceeded / private mode).
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
    localStorage.setItem(PALETTE_KEY, paletteId);
  } catch {
    /* storage unavailable — keep the in-memory theme */
  }
  listeners.forEach((l) => l());
}

export function getTheme(): Theme {
  return current;
}

// Re-apply when the OS preference flips while on 'system', and stay in sync
// across tabs when another tab changes the stored theme.
mql?.addEventListener('change', () => {
  if (current === 'system') apply();
  listeners.forEach((l) => l());
});
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY && e.key !== PALETTE_KEY && e.key !== null) return;
    current = read();
    paletteId = readPalette();
    apply();
    listeners.forEach((l) => l());
  });
  apply();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Snapshot must encode everything the render reads. getTheme() alone returns
// only the setting, so an OS light<->dark flip while on 'system' keeps the
// snapshot === 'system' and React bails out of the re-render — leaving any
// `resolved`-derived UI (the Settings hint today) stale against the DOM that
// apply() already re-themed. Fold `resolved` into the snapshot string so its
// identity changes on an OS flip.
function getSnapshot(): string {
  const t = getTheme();
  return `${t}:${resolveTheme(t)}:${paletteId}`;
}

/** React hook: current theme setting + the resolved light/dark it maps to. */
export function useTheme(): { theme: Theme; resolved: ResolvedTheme; palette: ThemeId } {
  useSyncExternalStore(subscribe, getSnapshot, () => 'system:light');
  const theme = getTheme();
  return { theme, resolved: resolveTheme(theme), palette: paletteId };
}
