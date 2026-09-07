import initUnocssRuntime from '@unocss/runtime';
import presetWind4 from '@unocss/preset-wind4';
import presetAnimations from 'unocss-preset-animations';
import { unoTheme, unoShortcuts, unoRules } from './genui-theme';
import '../genui.css';

// Every legacy entry boots the same reset before its app stylesheet. The runtime
// prepends its ordered style layers, so host CSS keeps its original cascade priority.
// It regenerates theme variables for all observed tokens, including later streamed classes.
void initUnocssRuntime({ defaults: { presets: [presetWind4(), presetAnimations()], theme: unoTheme, shortcuts: unoShortcuts, rules: unoRules, variants: [matcher => {
  // Published UI components still use Tailwind's fractional arbitrary opacity.
  // Wind4 requires a percentage here; leave every other arbitrary value intact.
  const opacity = /\/\[(0?\.\d+|1(?:\.0+)?)\]$/.exec(matcher);
  return opacity ? matcher.slice(0, opacity.index) + '/' + Number(opacity[1]) * 100 : undefined;
}] } });
