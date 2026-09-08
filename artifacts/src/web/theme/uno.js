import { presetWind4 } from '@unocss/preset-wind4';
import { presetAnimations } from 'unocss-preset-animations';

// The shell and generated surfaces compile the same semantic names; runtime rules stay scoped.
/** @param {string} [scope] @returns {import('@unocss/core').UserConfig} */
export const unoConfig = (scope) => ({
  presets: [presetWind4({ important: scope, preflights: { reset: !scope } }), presetAnimations()],
  theme: { colors: { surface: 'var(--surface)', 'surface-2': 'var(--surface-2)', 'surface-3': 'var(--surface-3)', border: 'var(--border)', fg: 'var(--fg)', muted: 'var(--muted)', accent: 'var(--accent)', 'accent-fg': 'var(--accent-fg)', danger: 'var(--danger)', success: 'var(--success)', warn: 'var(--warn)', ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`series-${index + 1}`, `var(--series-${index + 1})`])) } },
  shortcuts: { interactive: 'transition-[color,background-color,border-color,opacity,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]' },
});
