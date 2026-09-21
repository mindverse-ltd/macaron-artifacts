import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { selectionActions, type SelectionAction } from './selection-draft';

export function SelectionActions({ root, onQuote }: { root: RefObject<HTMLDivElement | null>; onQuote(text: string, action: SelectionAction): void }) {
  const [selection, setSelection] = useState<{ text: string; x: number; y: number; keyboard: boolean } | null>(null);
  const toolbar = useRef<HTMLDivElement>(null), keyboard = useRef(false);
  useEffect(() => {
    const update = () => {
      // Tabbing into the toolbar may collapse the native selection; retain the captured quote while it owns focus.
      if (toolbar.current?.contains(document.activeElement)) return;
      const selection = getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) { setSelection(null); return; }
      const range = selection.getRangeAt(0), parent = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      const start = parent(range.startContainer), end = parent(range.endContainer), answer = start?.closest('[data-answer-text]');
      const text = selection.toString().trim();
      if (!text || text.length > 8000 || !answer || !root.current?.contains(answer) || end?.closest('[data-answer-text]') !== answer || start?.closest('pre,button,input,textarea') || end?.closest('pre,button,input,textarea')) { setSelection(null); return; }
      const rect = range.getBoundingClientRect();
      if (!rect.width || rect.bottom < 0 || rect.top > innerHeight) { setSelection(null); return; }
      setSelection({ text, x: Math.max(8, Math.min(innerWidth - 256, rect.left + rect.width / 2 - 120)), y: rect.top >= 52 ? rect.top - 46 : rect.bottom + 8, keyboard: keyboard.current });
    };
    const pointer = () => { keyboard.current = false; update(); };
    const key = (event: KeyboardEvent) => { keyboard.current = true; if (event.key === 'Escape') { if (!toolbar.current) return; setSelection(null); root.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true }); } else update(); };
    const dismiss = (event: Event) => { if (!(event.target instanceof Node) || !toolbar.current?.contains(event.target)) setSelection(null); };
    document.addEventListener('selectionchange', update); document.addEventListener('pointerup', pointer); document.addEventListener('keyup', key); document.addEventListener('scroll', dismiss, true); window.addEventListener('resize', update);
    return () => { document.removeEventListener('selectionchange', update); document.removeEventListener('pointerup', pointer); document.removeEventListener('keyup', key); document.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', update); };
  }, [root]);
  if (!selection) return null;
  return createPortal(<div ref={toolbar} role="toolbar" aria-label="选中文字操作" data-export-control data-keyboard={selection.keyboard || undefined} className="selection-actions theme-widget fixed z-popover flex gap-1 rounded-full border border-contrast p-1 shadow-lg" style={{ left: selection.x, top: selection.y }} onPointerDown={event => event.preventDefault()}>{Object.entries(selectionActions).map(([action, label]) => <button key={action} type="button" aria-label={`对选中文字进行${label}`} className="interactive rounded-full px-3 py-2 text-xs hover:bg-surface-3 hover:text-hover-fg" onClick={() => { onQuote(selection.text, action as SelectionAction); setSelection(null); getSelection()?.removeAllRanges(); root.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true }); }}>{label}</button>)}</div>, document.body);
}
