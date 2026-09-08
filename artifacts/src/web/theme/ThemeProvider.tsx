import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { applyTheme, loadTheme, THEME_OPTIONS, type Appearance, type ThemeId } from './themes';

const STORAGE = 'macaron-artifacts:appearance';
function initialAppearance(): Appearance {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  try { const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null'); if (saved && THEME_OPTIONS.some(theme => theme.id === saved.id)) return { ...saved, syntax: saved.id === 'playground' ? saved.dark ? 'vitesse-dark' : 'vitesse-light' : saved.id, revision: 0 }; } catch { /* Preferences must never stop the application from opening. */ }
  return { id: 'playground', dark, syntax: dark ? 'vitesse-dark' : 'vitesse-light', revision: 0 };
}
type ThemeContextValue = { appearance: Appearance; select: (id: ThemeId) => void; toggle: () => void; error?: string };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(initialAppearance);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true;
    document.documentElement.dataset.theme = appearance.dark ? 'dark' : 'light';
    void loadTheme(appearance.syntax).then(theme => { if (current) { applyTheme(theme, appearance.id === 'playground', appearance.dark); setError(undefined); } }, reason => { if (current) setError(reason instanceof Error ? reason.message : '主题加载失败'); });
    try { localStorage.setItem(STORAGE, JSON.stringify({ id: appearance.id, dark: appearance.dark })); } catch { /* Nonessential preference storage. */ }
    return () => { current = false; };
  }, [appearance]);
  const select = (id: ThemeId) => setAppearance(previous => ({ id, dark: id === 'playground' ? previous.dark : id === 'nord' || id.endsWith('dark'), syntax: id === 'playground' ? previous.dark ? 'vitesse-dark' : 'vitesse-light' : id, revision: previous.revision + 1 }));
  const toggle = () => setAppearance(previous => { const dark = !previous.dark; const id: ThemeId = previous.id === 'playground' ? 'playground' : previous.id.startsWith('github') ? dark ? 'github-dark' : 'github-light' : dark ? 'vitesse-dark' : 'vitesse-light'; return { id, dark, syntax: id === 'playground' ? dark ? 'vitesse-dark' : 'vitesse-light' : id, revision: previous.revision + 1 }; });
  return <ThemeContext value={{ appearance, select, toggle, error }}>{children}</ThemeContext>;
}
export function useTheme() { const context = use(ThemeContext); if (!context) throw new Error('ThemeProvider is missing'); return context; }
