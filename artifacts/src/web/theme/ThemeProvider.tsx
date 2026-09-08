import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyTheme, loadTheme, oppositeTheme, THEME_OPTIONS, themeAppearance, type Appearance, type ThemeId } from './themes';

const STORAGE = 'macaron-artifacts:appearance';
function initialAppearance(): Appearance {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  try { const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null'); if (saved && THEME_OPTIONS.some(theme => theme.id === saved.id)) return themeAppearance(saved.id, typeof saved.dark === 'boolean' ? saved.dark : dark, 0); } catch { /* Preferences must never stop the application from opening. */ }
  return themeAppearance('playground', dark, 0);
}
type ThemeContextValue = { appearance: Appearance; selectedId: ThemeId; select: (id: ThemeId) => void; preview: (id: ThemeId | null) => void; toggle: () => void; error?: string };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState(initialAppearance);
  const [previewId, setPreviewId] = useState<ThemeId | null>(null);
  const [appearance, setAppearance] = useState(selection);
  const [error, setError] = useState<string>();
  const last = useRef<{ light: ThemeId; dark: ThemeId }>({ light: 'vitesse-light', dark: 'vitesse-dark' });
  const next = useMemo(() => previewId ? themeAppearance(previewId, selection.dark, selection.revision) : selection, [previewId, selection]);
  useEffect(() => {
    let current = true;
    void loadTheme(next.syntax).then(theme => {
      if (!current) return;
      // Commit palette, mode and syntax together; late hover imports cannot repaint a newer choice.
      applyTheme(theme, next.id === 'playground', next.dark);
      document.documentElement.dataset.palette = next.id;
      document.documentElement.dataset.themePreview = String(previewId !== null);
      setAppearance(next); setError(undefined);
      if (previewId === null) {
        if (next.id !== 'playground') last.current[next.dark ? 'dark' : 'light'] = next.id;
        try { localStorage.setItem(STORAGE, JSON.stringify({ id: next.id, dark: next.dark })); } catch { /* Nonessential preference storage. */ }
      }
    }, reason => { if (current) setError(reason instanceof Error ? reason.message : '主题加载失败'); });
    return () => { current = false; };
  }, [next, previewId]);
  const preview = useCallback((id: ThemeId | null) => setPreviewId(id), []);
  const select = useCallback((id: ThemeId) => { setPreviewId(null); setSelection(previous => themeAppearance(id, previous.dark, previous.revision + 1)); }, []);
  const toggle = useCallback(() => {
    setPreviewId(null);
    setSelection(previous => {
      const dark = !previous.dark;
      const remembered = last.current[dark ? 'dark' : 'light'];
      const counterpart = oppositeTheme(remembered, previous.dark) === previous.id ? remembered : oppositeTheme(previous.id, dark);
      return themeAppearance(previous.id === 'playground' ? 'playground' : counterpart ?? remembered, dark, previous.revision + 1);
    });
  }, []);
  return <ThemeContext value={{ appearance, selectedId: selection.id, select, preview, toggle, error }}>{children}</ThemeContext>;
}
export function useTheme() { const context = use(ThemeContext); if (!context) throw new Error('ThemeProvider is missing'); return context; }
