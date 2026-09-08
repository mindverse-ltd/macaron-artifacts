import { PALETTE_OPTIONS, setShikiTheme, useTheme } from '../lib/theme';
import '../palette.css';

export function PaletteSelect() {
  const { palette } = useTheme();
  return <label className="palette-select">Shiki theme<select aria-label="Shiki theme" value={palette} onChange={event => setShikiTheme(event.target.value as typeof palette)}>{PALETTE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
}
