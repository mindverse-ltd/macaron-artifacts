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
  const short = /^#([\da-f]{3})$/i.exec(color);
  const hex = short ? short[1].split('').map(value => value + value).join('') : /^#([\da-f]{6})$/i.exec(color)?.[1];
  if (!hex) return null;
  const channels = [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
export function readableForeground(background: string, foreground: string) {
  const back = luminance(background);
  const front = luminance(foreground);
  if (back === null || front === null || (Math.max(back, front) + .05) / (Math.min(back, front) + .05) >= 4.5) return foreground;
  // Editor themes are not necessarily accessible UI palettes: preserve the accent hue and choose a readable label.
  return (back + .05) / .05 >= 1.05 / (back + .05) ? '#000000' : '#ffffff';
}

export function applyTheme(theme: ThemeRegistration, playground: boolean, dark: boolean) {
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const colors = theme.colors ?? {};
  const background = colors['editor.background'] ?? theme.bg ?? (dark ? '#0e0e11' : '#ffffff');
  const foreground = colors['editor.foreground'] ?? theme.fg ?? (dark ? '#f2f2f5' : '#16161a');
  const blend = (amount: number) => `color-mix(in srgb, ${foreground} ${amount}%, ${background})`;
  const palette: Record<string, string> = {
    surface: background, 'surface-2': colors['editorWidget.background'] ?? blend(4), 'surface-3': colors['list.hoverBackground'] ?? blend(8),
    fg: foreground, border: colors['panel.border'] ?? blend(14), muted: colors.descriptionForeground ?? blend(58),
    accent: colors['button.background'] ?? foreground, 'accent-fg': colors['button.foreground'] ?? background,
    danger: colors['errorForeground'] ?? (dark ? '#ff6b83' : '#d9435f'), success: colors['gitDecoration.addedResourceForeground'] ?? (dark ? '#34d399' : '#15803d'), warn: colors['editorWarning.foreground'] ?? (dark ? '#fbbf24' : '#a16207'),
  };
  palette['accent-fg'] = readableForeground(palette.accent, palette['accent-fg']);
  // Playground remains the exact reference palette; its syntax still comes from Shiki's Vitesse.
  for (const [key, value] of Object.entries(palette)) playground && !['success', 'warn'].includes(key) ? root.style.removeProperty(`--${key}`) : root.style.setProperty(`--${key}`, value);
  root.style.colorScheme = dark ? 'dark' : 'light';
}
