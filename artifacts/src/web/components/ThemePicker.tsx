import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { filterThemes, THEME_OPTIONS, type ThemeId } from '../theme/themes';
import { Icon } from './Icon';

function ThemePreview({ id }: { id: ThemeId | null }) {
  const { preview } = useTheme();
  useEffect(() => { preview(id); return () => preview(null); }, [id, preview]);
  return null;
}

export function ThemePicker() {
  const { selectedId, select, preview } = useTheme();
  const [query, setQuery] = useState('');
  const [hoveredId, setHoveredId] = useState<ThemeId | null>(null);
  // Combobox normally commits its active option on Tab; previews only commit on Enter or click.
  const tabbing = useRef(false);
  const help = useId();
  const options = filterThemes(query);
  return <Combobox value={selectedId} onChange={id => { if (id && !tabbing.current) select(id); }} onClose={() => { setQuery(''); setHoveredId(null); preview(null); tabbing.current = false; }} immediate>
    {({ open, activeOption }) => <>
      <div className="relative">
        <ComboboxInput aria-label="主题" aria-describedby={help} displayValue={(id: ThemeId) => THEME_OPTIONS.find(theme => theme.id === id)?.label ?? ''} onChange={event => { setQuery(event.target.value); setHoveredId(null); }} onKeyDownCapture={event => { tabbing.current = event.key === 'Tab'; setHoveredId(null); }} placeholder="搜索配色…" className="interactive w-full rounded-lg border border-input-border bg-input-bg py-2 pr-9 pl-3 text-sm text-input-fg placeholder:text-input-placeholder focus:border-focus focus:outline-none" />
        <ComboboxButton aria-label="浏览所有主题" className="interactive absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-muted hover:text-fg"><Icon name="chevronDown" /></ComboboxButton>
      </div>
      <span id={help} className="sr-only">搜索主题，用方向键或悬停预览，Enter 确认，Esc 取消</span>
      <ThemePreview id={open ? hoveredId ?? (activeOption as ThemeId | null) : null} />
      <ComboboxOptions anchor={{ to: 'top start', gap: 6 }} onPointerLeave={() => setHoveredId(null)} className="z-50 max-h-[min(24rem,var(--anchor-max-height))] w-[var(--input-width)] min-w-56 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface-2 p-1 shadow-xl outline-none">
        {options.map(theme => <ComboboxOption key={theme.id} value={theme.id} onPointerEnter={event => { if (event.pointerType !== 'touch') setHoveredId(theme.id); }} className={({ focus }) => `interactive flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm data-[selected]:font-medium data-[selected]:text-fg ${(hoveredId ? hoveredId === theme.id : focus) ? 'bg-surface-3 text-fg' : 'text-muted'}`}>
          {({ selected }) => <><Icon name="check" className={`size-3 shrink-0 ${selected ? '' : 'opacity-0'}`} /><span className="min-w-0 flex-1">{theme.label}</span>{theme.type ? <Icon name={theme.type === 'dark' ? 'moon' : 'sun'} className="size-3.5 shrink-0" /> : null}</>}
        </ComboboxOption>)}
        {!options.length ? <p role="status" className="px-3 py-2 text-sm text-muted">没有匹配的主题</p> : null}
      </ComboboxOptions>
    </>}
  </Combobox>;
}
