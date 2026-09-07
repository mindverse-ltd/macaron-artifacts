import type { UnocssLintToolkit } from '@genui/diagnostics/lint';
import type { Preset, Rule, UserShortcuts } from '@unocss/core';
import type { Theme } from '@unocss/preset-wind4';

const hsl = (name: string) => `hsl(var(--macaron-${name}))`;
const withForeground = (name: string) => ({ DEFAULT: hsl(name), foreground: hsl(`${name}-foreground`) });

// Keep this host configuration aligned with web/src/lib/genui-theme.ts.
// The lint implementation stays in @genui/diagnostics/lint; this file only supplies the host's theme extensions.
const unoTheme: Theme = {
  colors: {
    border: hsl('border'),
    input: hsl('input'),
    ring: hsl('ring'),
    background: hsl('background'),
    foreground: hsl('foreground'),
    primary: withForeground('primary'),
    secondary: withForeground('secondary'),
    destructive: withForeground('destructive'),
    muted: withForeground('muted'),
    accent: withForeground('accent'),
    popover: withForeground('popover'),
    card: withForeground('card'),
  },
  radius: {
    lg: 'var(--macaron-radius)',
    md: 'calc(var(--macaron-radius) - 2px)',
    sm: 'calc(var(--macaron-radius) - 4px)',
  },
  font: {
    sans: 'var(--macaron-font-sans)',
    mono: 'var(--macaron-font-mono)',
  },
  animation: {
    keyframes: {
      'accordion-down': '{from{height:0}to{height:var(--radix-accordion-content-height)}}',
      'accordion-up': '{from{height:var(--radix-accordion-content-height)}to{height:0}}',
    },
    durations: { 'accordion-down': '0.2s', 'accordion-up': '0.2s' },
    timingFns: { 'accordion-down': 'ease-out', 'accordion-up': 'ease-out' },
  },
};

const unoShortcuts: UserShortcuts<Theme> = {
  'bg-macaron-gradient': 'bg-[linear-gradient(97.87deg,#FFC400_0.21%,#FF5A70_50.21%,#F63B3B_100.21%)]',
  'bg-macaron-gradient-new': 'bg-[linear-gradient(98deg,#FFC300_0.21%,#FF5A70_50.21%,#F63B3B_100.21%)]',
};

const unoRules: Rule<Theme>[] = [[/^transition-\[padding-left\]$/, () => ({ 'transition-property': 'padding-left' })]];

let toolkitPromise: Promise<UnocssLintToolkit> | undefined;

export const loadGenUIUnocssToolkit = (): Promise<UnocssLintToolkit> =>
  (toolkitPromise ??= Promise.all([
    import('@unocss/core'),
    import('@unocss/autocomplete'),
    import('@unocss/preset-wind4'),
    import('unocss-preset-animations'),
  ]).then(async ([core, autocomplete, wind4, animations]) => {
    // The animation preset still declares the Wind3 theme generic; its CSS-variable
    // rules also work with Wind4, which preserves the same animation configuration.
    const animationPreset = animations.presetAnimations() as unknown as Preset<Theme>;
    const generator = await core.createGenerator<object>(
      { theme: unoTheme, shortcuts: unoShortcuts, rules: unoRules },
      {
        presets: [wind4.default({ preflights: { reset: false } }), animationPreset],
        separators: [],
      },
    );
    return { generator, autocomplete: autocomplete.createAutocomplete(generator) };
  }));
