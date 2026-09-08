import { createHighlighterCore, type HighlighterCore, type ThemeRegistration } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

export const THEME_OPTIONS = [
  { id: 'playground', label: 'Playground' }, { id: 'vitesse-light', label: 'Vitesse Light' }, { id: 'vitesse-dark', label: 'Vitesse Dark' },
  { id: 'github-light', label: 'GitHub Light' }, { id: 'github-dark', label: 'GitHub Dark' }, { id: 'nord', label: 'Nord' },
] as const;
export type ThemeId = typeof THEME_OPTIONS[number]['id'];
export type Appearance = { id: ThemeId; dark: boolean; syntax: string; revision: number };
const THEME_LOADERS: Record<string, () => Promise<{ default: ThemeRegistration }>> = {
  'vitesse-light': () => import('@shikijs/themes/vitesse-light'), 'vitesse-dark': () => import('@shikijs/themes/vitesse-dark'),
  'github-light': () => import('@shikijs/themes/github-light'), 'github-dark': () => import('@shikijs/themes/github-dark'), nord: () => import('@shikijs/themes/nord'),
};
const LANGUAGES = {
  tsx: () => import('@shikijs/langs/tsx'), typescript: () => import('@shikijs/langs/typescript'), javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'), css: () => import('@shikijs/langs/css'), html: () => import('@shikijs/langs/html'), markdown: () => import('@shikijs/langs/markdown'),
  bash: () => import('@shikijs/langs/bash'), yaml: () => import('@shikijs/langs/yaml'), diff: () => import('@shikijs/langs/diff'),
};
const ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', jsx: 'tsx', md: 'markdown', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', txt: 'text', plaintext: 'text' };
export const normalizeLanguage = (language: string) => { const normalized = ALIASES[language] ?? language; return normalized in LANGUAGES ? normalized : 'text'; };
let core: Promise<HighlighterCore> | undefined;
const languageLoads = new Map<string, Promise<void>>();
const themeLoads = new Map<string, Promise<ThemeRegistration>>();
export const loadTheme = (name: string) => {
  let task = themeLoads.get(name);
  if (!task) { task = THEME_LOADERS[name]().then(module => module.default); themeLoads.set(name, task); }
  return task;
};

export async function highlighter(language: string, theme: string) {
  core ??= createHighlighterCore({ langs: [], themes: [], engine: createJavaScriptRegexEngine() });
  const engine = await core;
  const lang = normalizeLanguage(language);
  const jobs: Promise<unknown>[] = [];
  if (!engine.getLoadedThemes().includes(theme)) jobs.push(loadTheme(theme).then(value => engine.loadTheme(value)));
  if (lang !== 'text' && !languageLoads.has(lang)) languageLoads.set(lang, LANGUAGES[lang as keyof typeof LANGUAGES]().then(module => engine.loadLanguage(module.default as never)).then(() => undefined));
  const languageJob = languageLoads.get(lang);
  if (languageJob) jobs.push(languageJob);
  await Promise.all(jobs);
  return engine;
}

function luminance(color: string): number | null {
  const hex = parseHex(color)?.hex;
  if (!hex) return null;
  const channels = [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function parseHex(color: string) {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color);
  if (!match) return null;
  const value = match[1].length <= 4 ? match[1].split('').map(channel => channel + channel).join('') : match[1];
  return { hex: value.slice(0, 6), alpha: value.length === 8 ? Number.parseInt(value.slice(6), 16) / 255 : 1 };
}

function contrastRatio(background: string, foreground: string) {
  const back = parseHex(background);
  const front = parseHex(foreground);
  if (!back || !front) return null;
  const backRgb = [0, 2, 4].map(index => Number.parseInt(back.hex.slice(index, index + 2), 16) / 255);
  const frontRgb = [0, 2, 4].map(index => Number.parseInt(front.hex.slice(index, index + 2), 16) / 255);
  const composited = frontRgb.map((channel, index) => channel * front.alpha + backRgb[index] * (1 - front.alpha));
  const toLinear = (channel: number) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  const backLum = backRgb.map(toLinear).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const frontLum = composited.map(toLinear).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const [low, high] = [backLum, frontLum].sort((a, b) => a - b);
  return (high + .05) / (low + .05);
}
export function readableForeground(background: string, foreground: string) {
  const back = luminance(background);
  const front = luminance(foreground);
  if (back === null || front === null || (contrastRatio(background, foreground) ?? 4.5) >= 4.5) return foreground;
  // Editor themes are not necessarily accessible UI palettes: preserve the accent hue and choose a readable label.
  return (back + .05) / .05 >= 1.05 / (back + .05) ? '#000000' : '#ffffff';
}

/** Shiki description colors often carry alpha; keep their hue but avoid translucent text below AA contrast. */
export function readableMutedForeground(background: string, foreground: string) {
  if ((contrastRatio(background, foreground) ?? 4.5) >= 4.5) return foreground;
  const opaque = parseHex(foreground);
  if (opaque && (contrastRatio(background, `#${opaque.hex}`) ?? 0) >= 4.5) return `#${opaque.hex}`;
  return readableForeground(background, foreground);
}

export function themePalette(theme: ThemeRegistration, dark: boolean) {
  const colors = theme.colors ?? {};
  const background = colors['editor.background'] ?? theme.bg ?? (dark ? '#0e0e11' : '#ffffff');
  const foreground = colors['editor.foreground'] ?? theme.fg ?? (dark ? '#f2f2f5' : '#16161a');
  const blend = (amount: number) => `color-mix(in srgb, ${foreground} ${amount}%, ${background})`;
  const palette: Record<string, string> = {
    surface: background, 'surface-2': colors['editorWidget.background'] ?? blend(4), 'surface-3': colors['list.hoverBackground'] ?? blend(8),
    fg: foreground, border: colors['panel.border'] ?? blend(14), muted: readableMutedForeground(background, colors.descriptionForeground ?? blend(58)),
    accent: colors['button.background'] ?? foreground, 'accent-fg': colors['button.foreground'] ?? background,
    danger: colors['errorForeground'] ?? (dark ? '#ff6b83' : '#d9435f'), success: colors['gitDecoration.addedResourceForeground'] ?? (dark ? '#34d399' : '#15803d'), warn: colors['editorWarning.foreground'] ?? (dark ? '#fbbf24' : '#a16207'),
  };
  palette['accent-fg'] = readableForeground(palette.accent, palette['accent-fg']);
  return palette;
}

export function applyTheme(theme: ThemeRegistration, playground: boolean, dark: boolean) {
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const palette = themePalette(theme, dark);
  // Playground remains the exact reference palette; its syntax still comes from Shiki's Vitesse.
  for (const [key, value] of Object.entries(palette)) playground && !['success', 'warn'].includes(key) ? root.style.removeProperty(`--${key}`) : root.style.setProperty(`--${key}`, value);
  root.style.colorScheme = dark ? 'dark' : 'light';
}
