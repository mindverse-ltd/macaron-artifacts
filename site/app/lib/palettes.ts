import type { ThemeRegistration } from '@shikijs/types';
import { contrastRatio, themePalette } from '../../../artifacts/src/web/theme/palette';

const pairedPalettes = [{ id: 'vitesse', label: 'Vitesse', light: 'vitesse-light', dark: 'vitesse-dark' }, { id: 'github', label: 'GitHub', light: 'github-light', dark: 'github-dark' }] as const;
export const palettes = [{ id: 'neutral', label: 'Neutral' }, ...pairedPalettes] as const;
export type PaletteId = typeof palettes[number]['id'];
export type PaletteVariantId = Exclude<keyof typeof loaders, never>;
const legacyPaletteFamilies = { 'vitesse-light': 'vitesse', 'vitesse-dark': 'vitesse', 'github-light': 'github', 'github-dark': 'github' } as const;
export function paletteFamily(id: string | null | undefined): PaletteId | undefined { if (!id) return; if (palettes.some(palette => palette.id === id)) return id as PaletteId; return legacyPaletteFamilies[id as keyof typeof legacyPaletteFamilies]; }
export function paletteVariant(id: Exclude<PaletteId, 'neutral'>, mode: 'light' | 'dark'): PaletteVariantId { return pairedPalettes.find(item => item.id === id)![mode]; }
const loaders = { 'vitesse-light': () => import('@shikijs/themes/vitesse-light'), 'vitesse-dark': () => import('@shikijs/themes/vitesse-dark'), 'github-light': () => import('@shikijs/themes/github-light'), 'github-dark': () => import('@shikijs/themes/github-dark'), nord: () => import('@shikijs/themes/nord') };
export const syntaxThemes = { light: 'github-light', dark: 'github-dark', 'vitesse-light': 'vitesse-light', 'vitesse-dark': 'vitesse-dark', 'github-light': 'github-light', 'github-dark': 'github-dark', nord: 'nord' } as const;
export const loadPalette = async (id: PaletteVariantId) => (await loaders[id]()).default;

function luminance(hex: string) {
  const value = hex.replace('#', '');
  const expanded = value.length === 3 ? value.split('').map(channel => channel + channel).join('') : value;
  if (!/^[\da-f]{6}(?:[\da-f]{2})?$/i.test(expanded)) return null;
  const channels = [0, 2, 4].map(index => Number.parseInt(expanded.slice(index, index + 2), 16) / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
export function readableText(background: string, proposed: string) {
  const back = luminance(background), front = luminance(proposed);
  if (back === null || front === null || (Math.max(back, front) + .05) / (Math.min(back, front) + .05) >= 4.5) return proposed;
  return (back + .05) / .05 > 1.05 / (back + .05) ? '#000000' : '#ffffff';
}

export function paletteVariables(theme: ThemeRegistration): Record<string, string> {
  const dark = theme.type === 'dark';
  let palette = themePalette(theme, dark);
  // Editor themes often separate panes by a line alone. Docs use surface depth instead:
  // keep the native hue and lightness direction, then revalidate the sidebar's text and states.
  const sidebar = palette['sidebar-bg'], background = palette.surface;
  if (contrastRatio(sidebar, background) < 1.14) {
    const darker = sidebar === background ? !dark : luminance(sidebar)! < luminance(background)!;
    const channels = [1, 3, 5].map(index => Number.parseInt(sidebar.slice(index, index + 2), 16));
    for (let step = 1; step <= 100; step++) {
      const fill = `#${channels.map(channel => Math.round(channel + ((darker ? 0 : 255) - channel) * step / 100).toString(16).padStart(2, '0')).join('')}`;
      if (contrastRatio(fill, background) < 1.14) continue;
      palette = themePalette({ ...theme, colors: { ...theme.colors, 'sideBar.background': fill } }, dark);
      break;
    }
  }
  // Reuse the WebUI's alpha compositing and contrast correction. Fumadocs' primary mixes
  // text and fill roles, so navigation/link scopes below receive separate semantic tokens.
  return {
    background: palette.surface, foreground: palette.fg, card: palette['surface-2'], 'card-foreground': palette.fg,
    popover: palette['menu-bg'], 'popover-foreground': palette['menu-fg'],
    muted: palette['surface-2'], 'muted-foreground': palette.muted, border: palette.border, 'contrast-border': palette.contrast,
    primary: palette.accent, 'primary-foreground': palette['accent-fg'], 'primary-hover': palette['accent-hover'], link: palette.link,
    secondary: palette.secondary, 'secondary-foreground': palette['secondary-fg'], accent: palette['surface-3'], 'accent-foreground': palette['hover-fg'],
    ring: palette.focus, overlay: dark ? '#0008' : '#0003', destructive: palette.danger,
    info: palette.link, warning: palette.warn, error: palette.danger, success: palette.success, idea: palette.link,
    'sidebar-bg': palette['sidebar-bg'], 'sidebar-fg': palette['sidebar-fg'], 'sidebar-muted': palette['sidebar-muted'],
    'sidebar-hover': palette['sidebar-hover'], 'sidebar-hover-fg': palette['sidebar-hover-fg'], 'sidebar-focus': palette['sidebar-focus'],
    'sidebar-selection': palette['sidebar-selection'], 'sidebar-selection-fg': palette['sidebar-selection-fg'],
    'menu-hover': palette['menu-hover'], 'menu-hover-fg': palette['menu-hover-fg'], 'menu-focus': palette['menu-focus'], 'menu-muted': palette['menu-muted'],
    code: palette.code, 'code-fg': palette['code-fg'], 'inline-code': palette['inline-code'], 'inline-code-fg': palette['inline-code-fg'],
  };
}
